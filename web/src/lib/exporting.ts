'use server'

import { revalidatePath } from 'next/cache'
import { q, one, tx, pool, dbErrorMessage, isFrameworkError } from './db'
import { requirePermission } from './auth'
import { buildReports, type ReportScope } from './reports'
import { parseServiceAccount, syncToSheet, testConnection, type SheetTab } from './gsheets'

export type Result = { ok: true; message?: string } | { ok: false; error: string }

function fail(err: unknown): Result {
  if (isFrameworkError(err)) throw err
  return { ok: false, error: (err as Error)?.message ?? dbErrorMessage(err) }
}

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim()

export type TargetRow = {
  id: string
  name: string
  spreadsheet_id: string
  service_account_email: string
  scope: string
  is_enabled: boolean
  last_sync_at: string | null
  last_sync_ok: boolean | null
  last_sync_message: string | null
}

export async function listTargets(): Promise<TargetRow[]> {
  await requirePermission('coa.manage')
  return q<TargetRow>(
    `SELECT id::text, name, spreadsheet_id, service_account_email, scope, is_enabled,
            last_sync_at::text, last_sync_ok, last_sync_message
       FROM acc.export_targets ORDER BY id`
  )
}

export async function listSyncLog() {
  await requirePermission('coa.manage')
  return q<{
    started_at: string; succeeded: boolean | null; rows_written: number | null
    range_label: string | null; message: string | null; triggered_by: string | null
  }>(
    `SELECT started_at::text, succeeded, rows_written, range_label, message, triggered_by
       FROM acc.export_log ORDER BY started_at DESC LIMIT 15`
  )
}

/** บันทึกการเชื่อมต่อ Google Sheets พร้อมทดสอบก่อนว่าเขียนได้จริง */
export async function saveTarget(fd: FormData): Promise<Result> {
  try {
    const user = await requirePermission('coa.manage')

    const id = s(fd, 'id')
    const name = s(fd, 'name') || 'สำนักงานบัญชี'
    const scope = s(fd, 'scope') === 'PERIOD' ? 'PERIOD' : 'YEAR'
    const rawId = s(fd, 'spreadsheet_id')
    const json = s(fd, 'service_account_json')

    if (!rawId) return { ok: false, error: 'ต้องระบุ Spreadsheet ID หรือวางลิงก์ Google Sheet' }

    // รับได้ทั้ง ID ล้วนและลิงก์เต็ม
    const m = rawId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
    const spreadsheetId = m ? m[1] : rawId

    let saJson = json
    if (!saJson && id) {
      const cur = await one<{ service_account_json: string }>(
        `SELECT service_account_json FROM acc.export_targets WHERE id = $1::bigint`,
        [id]
      )
      saJson = cur?.service_account_json ?? ''
    }
    if (!saJson) return { ok: false, error: 'ต้องวางเนื้อหาไฟล์ JSON ของ Service Account' }

    const sa = parseServiceAccount(saJson)

    // ทดสอบจริงก่อนบันทึก จะได้ไม่เก็บค่าที่ใช้ไม่ได้ไว้
    const info = await testConnection(sa, spreadsheetId)

    await tx(user.username, async (c) => {
      if (id) {
        await c.query(
          `UPDATE acc.export_targets
              SET name=$1, spreadsheet_id=$2, service_account_email=$3,
                  service_account_json=$4, scope=$5
            WHERE id=$6::bigint`,
          [name, spreadsheetId, sa.client_email, saJson, scope, id]
        )
      } else {
        await c.query(
          `INSERT INTO acc.export_targets
             (name, spreadsheet_id, service_account_email, service_account_json, scope, created_by)
           VALUES ($1,$2,$3,$4,$5,$6::bigint)`,
          [name, spreadsheetId, sa.client_email, saJson, scope, user.id]
        )
      }
    })

    revalidatePath('/settings/export')
    return {
      ok: true,
      message: `เชื่อมต่อสำเร็จ — ไฟล์ "${info.title}" (มีอยู่แล้ว ${info.tabs.length} แท็บ)`,
    }
  } catch (err) {
    return fail(err)
  }
}

export async function toggleTarget(id: string, enabled: boolean): Promise<Result> {
  try {
    const user = await requirePermission('coa.manage')
    await tx(user.username, async (c) => {
      await c.query(`UPDATE acc.export_targets SET is_enabled=$2 WHERE id=$1::bigint`, [id, enabled])
    })
    revalidatePath('/settings/export')
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

export async function deleteTarget(id: string): Promise<Result> {
  try {
    const user = await requirePermission('coa.manage')
    await tx(user.username, async (c) => {
      await c.query(`DELETE FROM acc.export_targets WHERE id=$1::bigint`, [id])
    })
    revalidatePath('/settings/export')
    return { ok: true, message: 'ลบการเชื่อมต่อแล้ว' }
  } catch (err) {
    return fail(err)
  }
}

/** แปลงรายงานเป็นแท็บพร้อมส่ง */
async function buildTabs(scope: ReportScope) {
  const { reports, range, company, generatedAt } = await buildReports(scope)
  const tabs: SheetTab[] = reports.map((r) => ({
    name: r.sheetName,
    headers: r.headers,
    rows: r.rows,
    caption: [`${company} · ${r.title} · ${range.label} · ข้อมูล ณ ${generatedAt}`],
  }))
  return { tabs, range }
}

/** สั่งซิงก์เดี๋ยวนี้ */
export async function syncNow(targetId: string): Promise<Result> {
  try {
    const user = await requirePermission('coa.manage')
    return await runSync(targetId, user.username)
  } catch (err) {
    return fail(err)
  }
}

/**
 * ตัวซิงก์จริง แยกออกมาเพื่อให้ทั้งปุ่มในหน้าจอและงานตั้งเวลาเรียกใช้ร่วมกันได้
 * บันทึกผลลง export_log ทุกครั้งไม่ว่าสำเร็จหรือไม่
 */
export async function runSync(targetId: string, triggeredBy: string): Promise<Result> {
  const target = await one<{
    id: string; spreadsheet_id: string; service_account_json: string; scope: string; is_enabled: boolean
  }>(
    `SELECT id::text, spreadsheet_id, service_account_json, scope, is_enabled
       FROM acc.export_targets WHERE id = $1::bigint`,
    [targetId]
  )
  if (!target) return { ok: false, error: 'ไม่พบการเชื่อมต่อที่ระบุ' }
  if (!target.is_enabled) return { ok: false, error: 'การเชื่อมต่อนี้ถูกปิดใช้งานอยู่' }

  const logRes = await pool.query(
    `INSERT INTO acc.export_log (target_id, triggered_by) VALUES ($1::bigint, $2) RETURNING id::text`,
    [target.id, triggeredBy]
  )
  const logId = logRes.rows[0].id as string

  try {
    const sa = parseServiceAccount(target.service_account_json)
    const { tabs, range } = await buildTabs({ wholeYear: target.scope === 'YEAR' })
    const result = await syncToSheet(sa, target.spreadsheet_id, tabs)

    await pool.query(
      `UPDATE acc.export_log
          SET finished_at = now(), succeeded = TRUE, rows_written = $2,
              tabs = $3, range_label = $4, message = 'สำเร็จ'
        WHERE id = $1::bigint`,
      [logId, result.written, result.tabs.join(', '), range.label]
    )
    await pool.query(
      `UPDATE acc.export_targets
          SET last_sync_at = now(), last_sync_ok = TRUE,
              last_sync_message = $2
        WHERE id = $1::bigint`,
      [target.id, `ส่ง ${result.written} แถว ใน ${result.tabs.length} แท็บ (${range.label})`]
    )

    revalidatePath('/settings/export')
    return {
      ok: true,
      message: `ซิงก์สำเร็จ — ส่ง ${result.written.toLocaleString('th-TH')} แถว ใน ${result.tabs.length} แท็บ (${range.label})`,
    }
  } catch (err) {
    const message = (err as Error)?.message ?? 'ไม่ทราบสาเหตุ'
    await pool.query(
      `UPDATE acc.export_log
          SET finished_at = now(), succeeded = FALSE, message = $2 WHERE id = $1::bigint`,
      [logId, message]
    ).catch(() => {})
    await pool.query(
      `UPDATE acc.export_targets
          SET last_sync_at = now(), last_sync_ok = FALSE, last_sync_message = $2
        WHERE id = $1::bigint`,
      [target.id, message]
    ).catch(() => {})

    revalidatePath('/settings/export')
    return { ok: false, error: message }
  }
}

/** โทเคนสำหรับงานตั้งเวลาภายนอก */
export async function getCronToken(): Promise<string | null> {
  await requirePermission('coa.manage')
  const r = await one<{ value: string }>(
    `SELECT value FROM acc.system_settings WHERE key = 'EXPORT_CRON_TOKEN'`
  )
  return r?.value ?? null
}
