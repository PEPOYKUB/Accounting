import { q } from '@/lib/db'
import { requireUser, can } from '@/lib/auth'
import { saveBankAccount, toggleBankAccount } from '@/lib/master'
import { baht } from '@/lib/money'
import { CrudForm, ToggleButton, Collapsible } from '@/components/CrudPanel'
import NoPermission from '@/components/NoPermission'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'บัญชีธนาคาร · ระบบบัญชี' }

export default async function BanksPage() {
  const me = await requireUser()
  if (!can(me, 'coa.manage')) {
    return <NoPermission action="จัดการบัญชีธนาคาร" roles={me.roles} allowed={['CONTROLLER']} />
  }

  const rows = await q<{
    id: string; account_no: string; bank_name: string; branch_name: string | null
    account_name: string; account_type: string | null; is_active: boolean
    gl_code: string; gl_name: string; balance: string
  }>(`
    SELECT b.id::text, b.account_no, b.bank_name, b.branch_name, b.account_name,
           b.account_type, b.is_active, c.account_code AS gl_code, c.account_name AS gl_name,
           COALESCE((SELECT SUM(l.debit_amount - l.credit_amount)
                       FROM acc.journal_entry_lines l
                       JOIN acc.journal_entries je ON je.id = l.journal_entry_id
                      WHERE l.account_id = c.id AND je.status = 'POSTED'), 0)::text AS balance
      FROM acc.bank_accounts b
      JOIN acc.chart_of_accounts c ON c.id = b.gl_account_id
     ORDER BY b.id`)

  // บัญชีเงินสด/ธนาคารในผังบัญชีที่ผูกได้
  const cashAccounts = await q<{ account_code: string; account_name: string }>(`
    SELECT account_code, account_name
      FROM acc.chart_of_accounts
     WHERE is_active AND allow_posting AND cashflow_category = 'CASH'
     ORDER BY account_code`)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>บัญชีธนาคาร</h1>
          <p>ต้องมีอย่างน้อย 1 บัญชี จึงจะบันทึกรับเงินและจ่ายเงินได้</p>
        </div>
      </div>

      {cashAccounts.length === 0 && (
        <div className="alert warn">
          <div>
            ยังไม่มีบัญชีประเภทเงินสด/ธนาคารในผังบัญชี — ไปเพิ่มที่หน้า <strong>ผังบัญชี</strong> ก่อน
            โดยตั้งกลุ่มกระแสเงินสดเป็น “เงินสดและรายการเทียบเท่า”
          </div>
        </div>
      )}

      <Collapsible label="+ เพิ่มบัญชีธนาคาร" defaultOpen={rows.length === 0 && cashAccounts.length > 0}>
        <CrudForm action={saveBankAccount} submitLabel="เพิ่มบัญชี">
          <div className="row">
            <div className="field">
              <label>ธนาคาร *</label>
              <input type="text" name="bank_name" required placeholder="เช่น ธนาคารกสิกรไทย" />
            </div>
            <div className="field">
              <label>สาขา</label>
              <input type="text" name="branch_name" />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>เลขที่บัญชี *</label>
              <input type="text" name="account_no" required placeholder="123-4-56789-0" />
            </div>
            <div className="field">
              <label>ชื่อบัญชี *</label>
              <input type="text" name="account_name" required placeholder="ชื่อตามสมุดบัญชี" />
            </div>
            <div className="field">
              <label>ประเภทบัญชี</label>
              <select name="account_type" defaultValue="CURRENT">
                <option value="CURRENT">กระแสรายวัน</option>
                <option value="SAVINGS">ออมทรัพย์</option>
                <option value="FIXED">ฝากประจำ</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>ผูกกับบัญชีแยกประเภท *</label>
            <select name="gl_account_code" required defaultValue={cashAccounts[0]?.account_code ?? ''}>
              {cashAccounts.map((a) => (
                <option key={a.account_code} value={a.account_code}>
                  {a.account_code} {a.account_name}
                </option>
              ))}
            </select>
            <div className="hint">
              ยอดเงินของบัญชีนี้จะไปลงในบัญชีแยกประเภทที่เลือก · ควรใช้คนละบัญชีต่อหนึ่งบัญชีธนาคาร
              เพื่อให้กระทบยอดได้ง่าย
            </div>
          </div>
        </CrudForm>
      </Collapsible>

      <div className="card">
        <div className="card-head">บัญชีทั้งหมด</div>
        <div className="table-wrap">
          {rows.length === 0 ? (
            <div className="empty">ยังไม่มีบัญชีธนาคาร</div>
          ) : (
            <table className="tbl cards">
              <thead>
                <tr>
                  <th>ธนาคาร</th>
                  <th>เลขที่บัญชี</th>
                  <th>ชื่อบัญชี</th>
                  <th>บัญชีแยกประเภท</th>
                  <th className="num">ยอดคงเหลือ</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.5 }}>
                    <td data-label="ธนาคาร" className="card-title">
                      {r.bank_name}{r.branch_name ? ` (${r.branch_name})` : ''}
                    </td>
                    <td data-label="เลขที่บัญชี" className="code">{r.account_no}</td>
                    <td data-label="ชื่อบัญชี">{r.account_name}</td>
                    <td data-label="บัญชีแยกประเภท" className="code">{r.gl_code} {r.gl_name}</td>
                    <td data-label="ยอดคงเหลือ" className="num">{baht(r.balance)}</td>
                    <td data-label="สถานะ">
                      <ToggleButton id={r.id} active={r.is_active} action={toggleBankAccount} />
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
