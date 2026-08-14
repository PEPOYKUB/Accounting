import { q } from '@/lib/db'
import { requireUser, can } from '@/lib/auth'
import { savePartner, togglePartner } from '@/lib/master'
import { WHT_FORM_TH } from '@/lib/labels'
import { CrudForm, ToggleButton, Collapsible } from '@/components/CrudPanel'
import NoPermission from '@/components/NoPermission'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'ลูกค้าและผู้ขาย · ระบบบัญชี' }

export default async function PartnersPage() {
  const me = await requireUser()
  if (!can(me, 'doc.create')) {
    return <NoPermission action="จัดการข้อมูลลูกค้าและผู้ขาย" roles={me.roles}
      allowed={['CONTROLLER', 'SENIOR_ACCOUNTANT', 'AR_AP_CLERK']} />
  }

  const rows = await q<{
    id: string; partner_code: string; partner_name: string; partner_kind: string
    is_customer: boolean; is_vendor: boolean; tax_id: string | null; branch_code: string | null
    default_wht_rate: string | null; default_wht_form: string | null
    credit_days: number; is_active: boolean; docs: string
  }>(`
    SELECT p.id::text, p.partner_code, p.partner_name, p.partner_kind::text,
           p.is_customer, p.is_vendor, p.tax_id, p.branch_code,
           p.default_wht_rate::text, p.default_wht_form::text,
           p.credit_days, p.is_active,
           ((SELECT COUNT(*) FROM acc.ar_invoices i WHERE i.customer_id = p.id)
          + (SELECT COUNT(*) FROM acc.ap_bills b WHERE b.vendor_id = p.id))::text AS docs
      FROM acc.business_partners p
     ORDER BY p.partner_code`)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ลูกค้าและผู้ขาย</h1>
          <p>
            ทั้งหมด {rows.length} ราย · เลขประจำตัวผู้เสียภาษีและรหัสสาขาจำเป็นสำหรับรายงานภาษีซื้อ-ขาย
          </p>
        </div>
      </div>

      <Collapsible label="+ เพิ่มลูกค้าหรือผู้ขายใหม่" defaultOpen={rows.length === 0}>
        <CrudForm action={savePartner} submitLabel="เพิ่มคู่ค้า">
          <div className="row">
            <div className="field">
              <label>รหัสคู่ค้า *</label>
              <input type="text" name="partner_code" required placeholder="เช่น C001 หรือ V001" />
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label>ชื่อคู่ค้า *</label>
              <input type="text" name="partner_name" required placeholder="ชื่อตามที่จดทะเบียน" />
            </div>
          </div>

          <div className="row">
            <div className="field">
              <label>ประเภท</label>
              <select name="partner_kind" defaultValue="JURISTIC">
                <option value="JURISTIC">นิติบุคคล</option>
                <option value="INDIVIDUAL">บุคคลธรรมดา</option>
                <option value="GOVERNMENT">หน่วยงานราชการ</option>
                <option value="FOREIGN">ต่างประเทศ</option>
              </select>
            </div>
            <div className="field">
              <label>เลขประจำตัวผู้เสียภาษี</label>
              <input type="text" name="tax_id" inputMode="numeric" maxLength={13} placeholder="13 หลัก" />
            </div>
            <div className="field">
              <label>รหัสสาขา</label>
              <input type="text" name="branch_code" inputMode="numeric" maxLength={5} defaultValue="00000" />
            </div>
          </div>

          <div className="field">
            <label>ที่อยู่</label>
            <input type="text" name="address_line" placeholder="ใช้พิมพ์บนใบกำกับภาษี" />
          </div>

          <div className="row">
            <div className="field">
              <label>อัตราหัก ณ ที่จ่ายเริ่มต้น (%)</label>
              <input type="text" name="default_wht_rate" inputMode="decimal" defaultValue="3" />
              <div className="hint">ค่าบริการทั่วไป 3% · ค่าเช่า 5% · ค่าโฆษณา 2%</div>
            </div>
            <div className="field">
              <label>แบบยื่นภาษีหัก ณ ที่จ่าย</label>
              <select name="default_wht_form" defaultValue="PND53">
                {Object.entries(WHT_FORM_TH).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>เครดิต (วัน)</label>
              <input type="text" name="credit_days" inputMode="numeric" defaultValue="30" />
            </div>
          </div>

          <div className="field">
            <label>เป็นอะไรกับกิจการ *</label>
            <label className="check-line">
              <input type="checkbox" name="is_customer" defaultChecked /> ลูกค้า (ออกใบแจ้งหนี้ให้ได้)
            </label>
            <label className="check-line">
              <input type="checkbox" name="is_vendor" /> ผู้ขาย (ตั้งหนี้และจ่ายเงินได้)
            </label>
            <label className="check-line">
              <input type="checkbox" name="is_vat_registered" defaultChecked /> จดทะเบียนภาษีมูลค่าเพิ่ม
            </label>
          </div>
        </CrudForm>
      </Collapsible>

      <div className="card">
        <div className="card-head">รายชื่อทั้งหมด</div>
        <div className="table-wrap">
          {rows.length === 0 ? (
            <div className="empty">ยังไม่มีลูกค้าหรือผู้ขาย — เพิ่มรายแรกด้วยปุ่มด้านบน</div>
          ) : (
            <table className="tbl cards">
              <thead>
                <tr>
                  <th>รหัส</th>
                  <th>ชื่อ</th>
                  <th>เป็น</th>
                  <th>เลขผู้เสียภาษี</th>
                  <th className="num">หัก ณ ที่จ่าย</th>
                  <th className="num">เครดิต</th>
                  <th className="num">เอกสาร</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.5 }}>
                    <td data-label="รหัส" className="code card-title">{r.partner_code}</td>
                    <td data-label="ชื่อ">{r.partner_name}</td>
                    <td data-label="เป็น">
                      {r.is_customer && <span className="badge info" style={{ marginRight: 4 }}>ลูกค้า</span>}
                      {r.is_vendor && <span className="badge plain">ผู้ขาย</span>}
                    </td>
                    <td data-label="เลขผู้เสียภาษี" className="code">
                      {r.tax_id ?? <span className="badge warn">ยังไม่มี</span>}
                      {r.tax_id && r.branch_code ? ` / ${r.branch_code}` : ''}
                    </td>
                    <td data-label="หัก ณ ที่จ่าย" className="num">
                      {r.default_wht_rate ? `${Number(r.default_wht_rate)}%` : '—'}
                    </td>
                    <td data-label="เครดิต" className="num">{r.credit_days} วัน</td>
                    <td data-label="เอกสาร" className="num muted">{r.docs}</td>
                    <td data-label="สถานะ">
                      <ToggleButton id={r.id} active={r.is_active} action={togglePartner} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
