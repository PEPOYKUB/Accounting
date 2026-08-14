'use server'

import { revalidatePath } from 'next/cache'
import { tx, one, dbErrorMessage, isFrameworkError, pool } from './db'
import { requirePermission, requireUser } from './auth'
import { hashPassword, passwordProblem } from './password'

export type Result = { ok: true; message?: string } | { ok: false; error: string }

function fail(err: unknown): Result {
  if (isFrameworkError(err)) throw err
  return { ok: false, error: dbErrorMessage(err) }
}

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim()
const nullIfBlank = (v: string) => (v === '' ? null : v)

// =====================================================================
// ข้อมูลกิจการและค่าตั้งระบบ
// =====================================================================
export async function saveCompanySettings(fd: FormData): Promise<Result> {
  try {
    const user = await requirePermission('coa.manage')

    const taxId = s(fd, 'company_tax_id')
    if (taxId && !/^[0-9]{13}$/.test(taxId)) {
      return { ok: false, error: 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก' }
    }
    const branch = s(fd, 'company_branch_code')
    if (branch && !/^[0-9]{5}$/.test(branch)) {
      return { ok: false, error: 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก (สำนักงานใหญ่ = 00000)' }
    }
    const vatRate = s(fd, 'vat_rate')
    if (vatRate && !(Number(vatRate) >= 0 && Number(vatRate) <= 100)) {
      return { ok: false, error: 'อัตราภาษีมูลค่าเพิ่มต้องอยู่ระหว่าง 0 ถึง 100' }
    }

    await tx(user.username, async (c) => {
      const set = async (key: string, value: string) => {
        await c.query(
          `INSERT INTO acc.system_settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key, value]
        )
      }
      await set('COMPANY_NAME', s(fd, 'company_name'))
      await set('COMPANY_TAX_ID', taxId)
      await set('COMPANY_BRANCH_CODE', branch || '00000')
      await set('COMPANY_ADDRESS', s(fd, 'company_address'))
      await set('VAT_RATE', vatRate || '7.000')
      await set('ENFORCE_MAKER_CHECKER', fd.get('enforce_maker_checker') ? 'true' : 'false')
    })

    revalidatePath('/settings/company')
    revalidatePath('/', 'layout')
    return { ok: true, message: 'บันทึกข้อมูลกิจการแล้ว' }
  } catch (err) {
    return fail(err)
  }
}

// =====================================================================
// ปีบัญชีและงวดบัญชี
// =====================================================================
export async function createFiscalYear(fd: FormData): Promise<Result> {
  try {
    const user = await requirePermission('coa.manage')
    const startDate = s(fd, 'start_date')
    const yearCode = s(fd, 'year_code')

    if (!startDate) return { ok: false, error: 'ต้องระบุวันเริ่มต้นปีบัญชี' }
    if (!yearCode) return { ok: false, error: 'ต้องระบุชื่อปีบัญชี' }

    await tx(user.username, async (c) => {
      // สร้าง 12 งวดตามเดือนปฏิทินนับจากวันเริ่มต้น รองรับรอบบัญชีที่ไม่ตรงปีปฏิทิน
      await c.query(
        `WITH fy AS (
           INSERT INTO acc.fiscal_years (year_code, start_date, end_date)
           VALUES ($1, $2::date, ($2::date + INTERVAL '1 year - 1 day')::date)
           RETURNING id, start_date
         )
         INSERT INTO acc.accounting_periods
           (fiscal_year_id, period_no, period_name, start_date, end_date)
         SELECT fy.id,
                n,
                to_char((fy.start_date + make_interval(months => n - 1)), 'YYYY-MM'),
                (fy.start_date + make_interval(months => n - 1))::date,
                (fy.start_date + make_interval(months => n) - INTERVAL '1 day')::date
           FROM fy, generate_series(1, 12) n`,
        [yearCode, startDate]
      )
    })

    revalidatePath('/periods')
    return { ok: true, message: `สร้างปีบัญชี ${yearCode} พร้อม 12 งวดแล้ว` }
  } catch (err) {
    return fail(err)
  }
}

export async function reopenPeriod(periodId: string): Promise<Result> {
  try {
    const user = await requirePermission('period.close')
    await tx(user.username, async (c) => {
      const r = await c.query(
        `UPDATE acc.accounting_periods
            SET status = 'OPEN', closed_by = NULL, closed_at = NULL
          WHERE id = $1::bigint AND status = 'CLOSED'
          RETURNING period_name`,
        [periodId]
      )
      if (r.rowCount === 0) {
        throw new Error('เปิดงวดได้เฉพาะงวดที่สถานะเป็น CLOSED เท่านั้น (งวดที่ LOCKED เปิดไม่ได้)')
      }
    })
    revalidatePath('/periods')
    return { ok: true, message: 'เปิดงวดกลับมาแก้ไขได้แล้ว' }
  } catch (err) {
    return fail(err)
  }
}

// =====================================================================
// ลูกค้าและผู้ขาย
// =====================================================================
export async function savePartner(fd: FormData): Promise<Result> {
  try {
    const user = await requirePermission('doc.create')

    const id = s(fd, 'id')
    const code = s(fd, 'partner_code')
    const name = s(fd, 'partner_name')
    const taxId = s(fd, 'tax_id')
    const branch = s(fd, 'branch_code')
    const isCustomer = !!fd.get('is_customer')
    const isVendor = !!fd.get('is_vendor')

    if (!code) return { ok: false, error: 'ต้องระบุรหัสคู่ค้า' }
    if (!name) return { ok: false, error: 'ต้องระบุชื่อคู่ค้า' }
    if (!isCustomer && !isVendor) return { ok: false, error: 'ต้องเลือกอย่างน้อยหนึ่งอย่าง: ลูกค้า หรือ ผู้ขาย' }
    if (taxId && !/^[0-9]{13}$/.test(taxId)) {
      return { ok: false, error: 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก' }
    }
    if (branch && !/^[0-9]{5}$/.test(branch)) {
      return { ok: false, error: 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก (สำนักงานใหญ่ = 00000)' }
    }

    const params = [
      code, name, s(fd, 'partner_kind') || 'JURISTIC', isCustomer, isVendor,
      nullIfBlank(taxId), branch || '00000', nullIfBlank(s(fd, 'address_line')),
      !!fd.get('is_vat_registered'),
      nullIfBlank(s(fd, 'default_wht_rate')),
      nullIfBlank(s(fd, 'default_wht_form')),
      Number(s(fd, 'credit_days') || '30'),
    ]

    await tx(user.username, async (c) => {
      if (id) {
        await c.query(
          `UPDATE acc.business_partners SET
             partner_code=$1, partner_name=$2, partner_kind=$3::acc.partner_kind,
             is_customer=$4, is_vendor=$5, tax_id=$6, branch_code=$7, address_line=$8,
             is_vat_registered=$9, default_wht_rate=$10::acc.rate_pct,
             default_wht_form=$11::acc.wht_form, credit_days=$12
           WHERE id=$13::bigint`,
          [...params, id]
        )
      } else {
        await c.query(
          `INSERT INTO acc.business_partners
             (partner_code, partner_name, partner_kind, is_customer, is_vendor,
              tax_id, branch_code, address_line, is_vat_registered,
              default_wht_rate, default_wht_form, credit_days)
           VALUES ($1,$2,$3::acc.partner_kind,$4,$5,$6,$7,$8,$9,
                   $10::acc.rate_pct,$11::acc.wht_form,$12)`,
          params
        )
      }
    })

    revalidatePath('/settings/partners')
    return { ok: true, message: id ? 'แก้ไขข้อมูลคู่ค้าแล้ว' : `เพิ่ม ${name} แล้ว` }
  } catch (err) {
    return fail(err)
  }
}

export async function togglePartner(id: string, active: boolean): Promise<Result> {
  try {
    const user = await requirePermission('doc.create')
    await tx(user.username, async (c) => {
      await c.query(`UPDATE acc.business_partners SET is_active=$2 WHERE id=$1::bigint`, [id, active])
    })
    revalidatePath('/settings/partners')
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// =====================================================================
// บัญชีธนาคาร
// =====================================================================
export async function saveBankAccount(fd: FormData): Promise<Result> {
  try {
    const user = await requirePermission('coa.manage')

    const id = s(fd, 'id')
    const accountNo = s(fd, 'account_no')
    const bankName = s(fd, 'bank_name')
    const accountName = s(fd, 'account_name')
    const glCode = s(fd, 'gl_account_code')

    if (!accountNo || !bankName || !accountName) {
      return { ok: false, error: 'ต้องระบุธนาคาร เลขที่บัญชี และชื่อบัญชี' }
    }
    if (!glCode) return { ok: false, error: 'ต้องเลือกบัญชีแยกประเภทที่ผูกกับบัญชีธนาคารนี้' }

    await tx(user.username, async (c) => {
      const params = [
        accountNo, bankName, nullIfBlank(s(fd, 'branch_name')), accountName,
        s(fd, 'account_type') || 'CURRENT', glCode,
      ]
      if (id) {
        await c.query(
          `UPDATE acc.bank_accounts SET
             account_no=$1, bank_name=$2, branch_name=$3, account_name=$4, account_type=$5,
             gl_account_id=(SELECT id FROM acc.chart_of_accounts WHERE account_code=$6)
           WHERE id=$7::bigint`,
          [...params, id]
        )
      } else {
        await c.query(
          `INSERT INTO acc.bank_accounts
             (account_no, bank_name, branch_name, account_name, account_type, gl_account_id)
           VALUES ($1,$2,$3,$4,$5,(SELECT id FROM acc.chart_of_accounts WHERE account_code=$6))`,
          params
        )
      }
    })

    revalidatePath('/settings/banks')
    return { ok: true, message: id ? 'แก้ไขบัญชีธนาคารแล้ว' : 'เพิ่มบัญชีธนาคารแล้ว' }
  } catch (err) {
    return fail(err)
  }
}

export async function toggleBankAccount(id: string, active: boolean): Promise<Result> {
  try {
    const user = await requirePermission('coa.manage')
    await tx(user.username, async (c) => {
      await c.query(`UPDATE acc.bank_accounts SET is_active=$2 WHERE id=$1::bigint`, [id, active])
    })
    revalidatePath('/settings/banks')
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// =====================================================================
// ศูนย์ต้นทุน
// =====================================================================
export async function saveCostCenter(fd: FormData): Promise<Result> {
  try {
    const user = await requirePermission('coa.manage')
    const id = s(fd, 'id')
    const code = s(fd, 'code')
    const name = s(fd, 'name')
    if (!code || !name) return { ok: false, error: 'ต้องระบุรหัสและชื่อศูนย์ต้นทุน' }

    await tx(user.username, async (c) => {
      if (id) {
        await c.query(`UPDATE acc.cost_centers SET code=$1, name=$2 WHERE id=$3::bigint`, [code, name, id])
      } else {
        await c.query(`INSERT INTO acc.cost_centers (code, name) VALUES ($1,$2)`, [code, name])
      }
    })
    revalidatePath('/settings/cost-centers')
    return { ok: true, message: id ? 'แก้ไขแล้ว' : 'เพิ่มศูนย์ต้นทุนแล้ว' }
  } catch (err) {
    return fail(err)
  }
}

export async function toggleCostCenter(id: string, active: boolean): Promise<Result> {
  try {
    const user = await requirePermission('coa.manage')
    await tx(user.username, async (c) => {
      await c.query(`UPDATE acc.cost_centers SET is_active=$2 WHERE id=$1::bigint`, [id, active])
    })
    revalidatePath('/settings/cost-centers')
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// =====================================================================
// ผังบัญชี
// =====================================================================
export async function saveAccount(fd: FormData): Promise<Result> {
  try {
    const user = await requirePermission('coa.manage')

    const id = s(fd, 'id')
    const code = s(fd, 'account_code')
    const name = s(fd, 'account_name')
    const type = s(fd, 'account_type')

    if (!code || !name) return { ok: false, error: 'ต้องระบุรหัสและชื่อบัญชี' }
    if (!/^[0-9]{4,10}$/.test(code)) return { ok: false, error: 'รหัสบัญชีต้องเป็นตัวเลข 4-10 หลัก' }

    await tx(user.username, async (c) => {
      if (id) {
        // ห้ามเปลี่ยนประเภทบัญชีที่มีรายการแล้ว เพราะจะทำให้งบการเงินย้อนหลังเพี้ยน
        const used = await c.query(
          `SELECT COUNT(*)::int AS n FROM acc.journal_entry_lines WHERE account_id = $1::bigint`,
          [id]
        )
        if (used.rows[0].n > 0) {
          const cur = await c.query(
            `SELECT account_type::text, account_code FROM acc.chart_of_accounts WHERE id=$1::bigint`,
            [id]
          )
          if (cur.rows[0].account_type !== type) {
            throw new Error(
              `บัญชี ${cur.rows[0].account_code} มีรายการบันทึกแล้ว ${used.rows[0].n} บรรทัด ` +
              'จึงเปลี่ยนประเภทบัญชีไม่ได้ ถ้าต้องการเปลี่ยนให้สร้างบัญชีใหม่แทน'
            )
          }
        }
        await c.query(
          `UPDATE acc.chart_of_accounts SET
             account_code=$1, account_name=$2, account_name_en=$3,
             account_subtype=$4, npae_report_line=$5,
             allow_posting=$6, cashflow_category=$7::acc.cashflow_cat
           WHERE id=$8::bigint`,
          [
            code, name, nullIfBlank(s(fd, 'account_name_en')),
            nullIfBlank(s(fd, 'account_subtype')), nullIfBlank(s(fd, 'npae_report_line')),
            !!fd.get('allow_posting'), s(fd, 'cashflow_category') || 'NONE', id,
          ]
        )
      } else {
        const normal = ['ASSET', 'EXPENSE'].includes(type) ? 'DEBIT' : 'CREDIT'
        await c.query(
          `INSERT INTO acc.chart_of_accounts
             (account_code, account_name, account_name_en, account_type, account_subtype,
              normal_balance, allow_posting, is_contra, cashflow_category, npae_report_line)
           VALUES ($1,$2,$3,$4::acc.account_type,$5,$6::acc.normal_balance,$7,$8,
                   $9::acc.cashflow_cat,$10)`,
          [
            code, name, nullIfBlank(s(fd, 'account_name_en')), type,
            nullIfBlank(s(fd, 'account_subtype')),
            fd.get('is_contra') ? (normal === 'DEBIT' ? 'CREDIT' : 'DEBIT') : normal,
            !!fd.get('allow_posting'), !!fd.get('is_contra'),
            s(fd, 'cashflow_category') || 'NONE', nullIfBlank(s(fd, 'npae_report_line')),
          ]
        )
      }
    })

    revalidatePath('/accounts')
    return { ok: true, message: id ? 'แก้ไขบัญชีแล้ว' : `เพิ่มบัญชี ${code} แล้ว` }
  } catch (err) {
    return fail(err)
  }
}

export async function toggleAccount(id: string, active: boolean): Promise<Result> {
  try {
    const user = await requirePermission('coa.manage')
    await tx(user.username, async (c) => {
      await c.query(`UPDATE acc.chart_of_accounts SET is_active=$2 WHERE id=$1::bigint`, [id, active])
    })
    revalidatePath('/accounts')
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// =====================================================================
// ผู้ใช้งาน
// =====================================================================
export async function saveUser(fd: FormData): Promise<Result> {
  try {
    const admin = await requirePermission('user.manage')

    const id = s(fd, 'id')
    const username = s(fd, 'username').toLowerCase()
    const fullName = s(fd, 'full_name')
    const email = s(fd, 'email')
    const roles = fd.getAll('roles').map(String).filter(Boolean)

    if (!username || !fullName) return { ok: false, error: 'ต้องระบุชื่อผู้ใช้และชื่อ-นามสกุล' }
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return { ok: false, error: 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3-32 ตัว' }
    }
    if (roles.length === 0) return { ok: false, error: 'ต้องกำหนดบทบาทอย่างน้อย 1 บทบาท' }

    await tx(admin.username, async (c) => {
      let userId = id
      if (id) {
        await c.query(
          `UPDATE acc.app_users SET username=$1, full_name=$2, email=$3 WHERE id=$4::bigint`,
          [username, fullName, nullIfBlank(email), id]
        )
      } else {
        const pw = s(fd, 'password')
        const problem = passwordProblem(pw)
        if (problem) throw new Error(problem)
        const hash = await hashPassword(pw)
        const r = await c.query(
          `INSERT INTO acc.app_users (username, full_name, email, password_hash, must_change_password)
           VALUES ($1,$2,$3,$4,TRUE) RETURNING id::text`,
          [username, fullName, nullIfBlank(email), hash]
        )
        userId = r.rows[0].id
      }

      await c.query(`DELETE FROM acc.user_roles WHERE user_id=$1::bigint`, [userId])
      for (const role of roles) {
        await c.query(
          `INSERT INTO acc.user_roles (user_id, role_code) VALUES ($1::bigint,$2)`,
          [userId, role]
        )
      }
    })

    revalidatePath('/settings/users')
    return { ok: true, message: id ? 'แก้ไขผู้ใช้แล้ว' : `เพิ่มผู้ใช้ ${username} แล้ว — ระบบจะบังคับตั้งรหัสผ่านใหม่เมื่อเข้าครั้งแรก` }
  } catch (err) {
    return fail(err)
  }
}

export async function resetUserPassword(userId: string, newPassword: string): Promise<Result> {
  try {
    const admin = await requirePermission('user.manage')
    const problem = passwordProblem(newPassword)
    if (problem) return { ok: false, error: problem }

    const hash = await hashPassword(newPassword)
    await tx(admin.username, async (c) => {
      await c.query(
        `UPDATE acc.app_users
            SET password_hash=$2, must_change_password=TRUE,
                failed_attempts=0, locked_until=NULL
          WHERE id=$1::bigint`,
        [userId, hash]
      )
      // ตัดทุกเซสชันของผู้ใช้รายนี้ทิ้ง
      await c.query(
        `UPDATE acc.user_sessions SET revoked_at=now()
          WHERE user_id=$1::bigint AND revoked_at IS NULL`,
        [userId]
      )
    })
    revalidatePath('/settings/users')
    return { ok: true, message: 'ตั้งรหัสผ่านใหม่แล้ว ผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าครั้งถัดไป' }
  } catch (err) {
    return fail(err)
  }
}

export async function toggleUser(userId: string, active: boolean): Promise<Result> {
  try {
    const admin = await requirePermission('user.manage')
    if (admin.id === userId && !active) {
      return { ok: false, error: 'ปิดใช้งานบัญชีของตัวเองไม่ได้' }
    }

    if (!active) {
      // ต้องเหลือผู้จัดการบัญชีที่ใช้งานได้อย่างน้อยหนึ่งคนเสมอ มิฉะนั้นจะไม่มีใครปิดงวดหรือจัดการผู้ใช้ได้
      const remaining = await one<{ n: number }>(
        `SELECT COUNT(*)::int AS n
           FROM acc.app_users u
           JOIN acc.user_roles ur ON ur.user_id = u.id
          WHERE ur.role_code = 'CONTROLLER' AND u.is_active AND u.id <> $1::bigint`,
        [userId]
      )
      if ((remaining?.n ?? 0) === 0) {
        return { ok: false, error: 'ต้องมีผู้จัดการบัญชีที่ใช้งานได้อย่างน้อย 1 คน ปิดคนสุดท้ายไม่ได้' }
      }
    }

    await tx(admin.username, async (c) => {
      await c.query(`UPDATE acc.app_users SET is_active=$2 WHERE id=$1::bigint`, [userId, active])
      if (!active) {
        await c.query(
          `UPDATE acc.user_sessions SET revoked_at=now()
            WHERE user_id=$1::bigint AND revoked_at IS NULL`,
          [userId]
        )
      }
    })
    revalidatePath('/settings/users')
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// =====================================================================
// ติดตั้งครั้งแรก — ใช้ได้เฉพาะตอนที่ยังไม่มีผู้ใช้ในระบบเลย
// =====================================================================
export async function isFirstRun(): Promise<boolean> {
  try {
    const r = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM acc.app_users`)
    return (r?.n ?? 0) === 0
  } catch {
    return false
  }
}

export async function runFirstSetup(fd: FormData): Promise<Result> {
  try {
    // ด่านสำคัญ: ถ้ามีผู้ใช้อยู่แล้วต้องปฏิเสธทันที มิฉะนั้นใครก็สร้างผู้ดูแลใหม่ได้
    if (!(await isFirstRun())) {
      return { ok: false, error: 'ระบบถูกติดตั้งไปแล้ว หน้านี้ใช้ได้เฉพาะการติดตั้งครั้งแรกเท่านั้น' }
    }

    const companyName = s(fd, 'company_name')
    const taxId = s(fd, 'company_tax_id')
    const branch = s(fd, 'company_branch_code') || '00000'
    const fyStart = s(fd, 'fiscal_year_start')
    const username = s(fd, 'username').toLowerCase()
    const fullName = s(fd, 'full_name')
    const email = s(fd, 'email')
    const password = s(fd, 'password')
    const confirm = s(fd, 'confirm_password')

    if (!companyName) return { ok: false, error: 'ต้องระบุชื่อกิจการ' }
    if (taxId && !/^[0-9]{13}$/.test(taxId)) {
      return { ok: false, error: 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก' }
    }
    if (!/^[0-9]{5}$/.test(branch)) {
      return { ok: false, error: 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก (สำนักงานใหญ่ = 00000)' }
    }
    if (!fyStart) return { ok: false, error: 'ต้องระบุวันเริ่มต้นปีบัญชี' }
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return { ok: false, error: 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3-32 ตัว' }
    }
    if (!fullName) return { ok: false, error: 'ต้องระบุชื่อ-นามสกุลผู้ดูแล' }
    if (password !== confirm) return { ok: false, error: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' }
    const problem = passwordProblem(password)
    if (problem) return { ok: false, error: problem }

    const hash = await hashPassword(password)
    const fyCode = 'FY' + fyStart.slice(0, 4)

    await tx(username, async (c) => {
      const set = async (key: string, value: string) => {
        await c.query(
          `INSERT INTO acc.system_settings (key, value) VALUES ($1,$2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key, value]
        )
      }
      await set('COMPANY_NAME', companyName)
      await set('COMPANY_TAX_ID', taxId)
      await set('COMPANY_BRANCH_CODE', branch)
      await set('COMPANY_ADDRESS', s(fd, 'company_address'))
      // ทีมเล็กมักมีคนเดียว จึงเริ่มด้วยการปิดกฎแยกผู้บันทึกกับผู้อนุมัติไว้ก่อน
      // เปิดได้ภายหลังที่หน้าตั้งค่ากิจการเมื่อมีผู้ใช้มากกว่าหนึ่งคน
      await set('ENFORCE_MAKER_CHECKER', fd.get('enforce_maker_checker') ? 'true' : 'false')

      await c.query(
        `WITH fy AS (
           INSERT INTO acc.fiscal_years (year_code, start_date, end_date)
           VALUES ($1, $2::date, ($2::date + INTERVAL '1 year - 1 day')::date)
           RETURNING id, start_date
         )
         INSERT INTO acc.accounting_periods
           (fiscal_year_id, period_no, period_name, start_date, end_date)
         SELECT fy.id, n,
                to_char((fy.start_date + make_interval(months => n - 1)), 'YYYY-MM'),
                (fy.start_date + make_interval(months => n - 1))::date,
                (fy.start_date + make_interval(months => n) - INTERVAL '1 day')::date
           FROM fy, generate_series(1, 12) n`,
        [fyCode, fyStart]
      )

      const u = await c.query(
        `INSERT INTO acc.app_users (username, full_name, email, password_hash, must_change_password)
         VALUES ($1,$2,$3,$4,FALSE) RETURNING id::text`,
        [username, fullName, nullIfBlank(email), hash]
      )
      await c.query(
        `INSERT INTO acc.user_roles (user_id, role_code) VALUES ($1::bigint,'CONTROLLER')`,
        [u.rows[0].id]
      )
    })

    revalidatePath('/', 'layout')
    return { ok: true, message: 'ติดตั้งเรียบร้อย' }
  } catch (err) {
    return fail(err)
  }
}

/** ตรวจว่ายังขาดข้อมูลตั้งต้นอะไรบ้างก่อนเริ่มบันทึกเอกสารได้ */
export async function setupChecklist() {
  await requireUser()
  const r = await one<{
    periods: number; partners: number; customers: number; vendors: number
    banks: number; company: number; entries: number
  }>(`
    SELECT
      (SELECT COUNT(*) FROM acc.accounting_periods WHERE status='OPEN')::int AS periods,
      (SELECT COUNT(*) FROM acc.business_partners WHERE is_active)::int      AS partners,
      (SELECT COUNT(*) FROM acc.business_partners WHERE is_active AND is_customer)::int AS customers,
      (SELECT COUNT(*) FROM acc.business_partners WHERE is_active AND is_vendor)::int   AS vendors,
      (SELECT COUNT(*) FROM acc.bank_accounts WHERE is_active)::int          AS banks,
      (SELECT COUNT(*) FROM acc.system_settings WHERE key='COMPANY_NAME' AND value <> '')::int AS company,
      (SELECT COUNT(*) FROM acc.journal_entries WHERE status='POSTED')::int  AS entries
  `)
  return r
}

/** ปิดการเชื่อมต่อค้างเมื่อ dev server รีโหลด (ไม่ให้ pool รั่ว) */
export async function ping(): Promise<boolean> {
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}
