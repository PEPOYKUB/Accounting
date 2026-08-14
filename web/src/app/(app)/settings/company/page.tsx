import Link from 'next/link'
import { q } from '@/lib/db'
import { requireUser, can } from '@/lib/auth'
import { saveCompanySettings, setupChecklist } from '@/lib/master'
import { CrudForm } from '@/components/CrudPanel'
import NoPermission from '@/components/NoPermission'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'ตั้งค่ากิจการ · ระบบบัญชี' }

export default async function CompanyPage() {
  const me = await requireUser()
  if (!can(me, 'coa.manage')) {
    return <NoPermission action="แก้ไขข้อมูลกิจการ" roles={me.roles} allowed={['CONTROLLER']} />
  }

  const rows = await q<{ key: string; value: string }>(`SELECT key, value FROM acc.system_settings`)
  const v = (k: string, d = '') => rows.find((r) => r.key === k)?.value ?? d
  const check = await setupChecklist()

  const items = [
    { ok: (check?.company ?? 0) > 0, label: 'กรอกข้อมูลกิจการ', href: '/settings/company' },
    { ok: (check?.periods ?? 0) > 0, label: 'มีงวดบัญชีที่เปิดอยู่', href: '/periods' },
    { ok: (check?.banks ?? 0) > 0, label: 'มีบัญชีธนาคารอย่างน้อย 1 บัญชี', href: '/settings/banks' },
    { ok: (check?.customers ?? 0) > 0, label: 'มีลูกค้าอย่างน้อย 1 ราย', href: '/settings/partners' },
    { ok: (check?.vendors ?? 0) > 0, label: 'มีผู้ขายอย่างน้อย 1 ราย', href: '/settings/partners' },
  ]
  const remaining = items.filter((i) => !i.ok).length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ตั้งค่ากิจการ</h1>
          <p>ข้อมูลนี้ใช้พิมพ์บนเอกสารและรายงานภาษี</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          ความพร้อมก่อนเริ่มบันทึกเอกสาร
          <span className={`badge ${remaining === 0 ? 'ok' : 'warn'}`}>
            {remaining === 0 ? 'พร้อมใช้งานครบแล้ว' : `ยังขาด ${remaining} อย่าง`}
          </span>
        </div>
        <div className="table-wrap">
          <table className="tbl cards">
            <tbody>
              {items.map((i) => (
                <tr key={i.label}>
                  <td data-label="รายการ">{i.label}</td>
                  <td data-label="สถานะ" style={{ width: 150, textAlign: 'right' }}>
                    {i.ok ? (
                      <span className="badge ok">เรียบร้อย</span>
                    ) : (
                      <Link className="btn sm" href={i.href}>ไปตั้งค่า</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <CrudForm title="ข้อมูลกิจการ" action={saveCompanySettings}>
          <div className="field">
            <label>ชื่อกิจการ *</label>
            <input type="text" name="company_name" defaultValue={v('COMPANY_NAME')} required />
          </div>
          <div className="row">
            <div className="field">
              <label>เลขประจำตัวผู้เสียภาษี</label>
              <input type="text" name="company_tax_id" inputMode="numeric" maxLength={13}
                defaultValue={v('COMPANY_TAX_ID')} placeholder="13 หลัก" />
            </div>
            <div className="field">
              <label>รหัสสาขา</label>
              <input type="text" name="company_branch_code" inputMode="numeric" maxLength={5}
                defaultValue={v('COMPANY_BRANCH_CODE', '00000')} />
              <div className="hint">สำนักงานใหญ่ใช้ 00000</div>
            </div>
            <div className="field">
              <label>อัตราภาษีมูลค่าเพิ่ม (%)</label>
              <input type="text" name="vat_rate" inputMode="decimal" defaultValue={v('VAT_RATE', '7.000')} />
            </div>
          </div>
          <div className="field">
            <label>ที่อยู่ตามที่จดทะเบียน</label>
            <input type="text" name="company_address" defaultValue={v('COMPANY_ADDRESS')} />
          </div>

          <div className="field">
            <label>การควบคุมภายใน</label>
            <label className="check-line">
              <input type="checkbox" name="enforce_maker_checker"
                defaultChecked={v('ENFORCE_MAKER_CHECKER') === 'true'} />
              <span>
                <strong>บังคับให้ผู้อนุมัติเป็นคนละคนกับผู้บันทึก</strong>
                <span className="muted" style={{ fontSize: 12, display: 'block' }}>
                  เป็นหลักการแบ่งแยกหน้าที่ที่ผู้สอบบัญชีคาดหวัง · ถ้าทีมมีคนเดียวต้องปิดไว้
                  มิฉะนั้นจะบันทึกเอกสารไม่ได้เลย
                </span>
              </span>
            </label>
          </div>
        </CrudForm>
      </div>
    </>
  )
}
