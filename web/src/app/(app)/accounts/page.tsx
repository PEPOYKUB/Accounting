import { q } from '@/lib/db'
import { baht } from '@/lib/money'
import { ACCOUNT_TYPE_TH } from '@/lib/labels'
import { requireUser, can } from '@/lib/auth'
import { toggleAccount } from '@/lib/master'
import { ToggleButton } from '@/components/CrudPanel'
import AccountForm from '@/components/AccountForm'

export const dynamic = 'force-dynamic'

export default async function AccountsPage() {
  const me = await requireUser()
  const canManage = can(me, 'coa.manage')

  const rows = await q<{
    id: string; account_code: string; account_name: string; account_type: string
    allow_posting: boolean; is_contra: boolean; is_active: boolean
    npae_report_line: string | null; balance: string; line_count: string
  }>(`
    SELECT a.id::text, a.account_code, a.account_name, a.account_type::text,
           a.allow_posting, a.is_contra, a.is_active, a.npae_report_line,
           COALESCE(SUM(l.debit_amount - l.credit_amount) FILTER (WHERE je.status = 'POSTED'), 0)::text AS balance,
           COUNT(l.id) FILTER (WHERE je.status = 'POSTED')::text AS line_count
      FROM acc.chart_of_accounts a
      LEFT JOIN acc.journal_entry_lines l ON l.account_id = a.id
      LEFT JOIN acc.journal_entries je ON je.id = l.journal_entry_id
     GROUP BY a.id, a.account_code, a.account_name, a.account_type,
              a.allow_posting, a.is_contra, a.is_active, a.npae_report_line
     ORDER BY a.account_code`)

  const groups = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ผังบัญชี</h1>
          <p>
            {rows.length} บัญชี · แกนกลางที่ทุกโมดูลอ้างอิง —
            บัญชีที่ทำเครื่องหมาย “บัญชีคุม” ห้ามลงรายการโดยตรง ระบบจะปฏิเสธที่ระดับฐานข้อมูล
          </p>
        </div>
      </div>

      {canManage && <AccountForm />}

      {groups.map((g) => {
        const items = rows.filter((r) => r.account_type === g)
        if (items.length === 0) return null
        const total = items
          .filter((r) => r.allow_posting)
          .reduce((a, r) => a + Number(r.balance), 0)

        return (
          <div className="card" style={{ marginBottom: 14 }} key={g}>
            <div className="card-head">
              {ACCOUNT_TYPE_TH[g]}
              <span className="mono">{baht(total)}</span>
            </div>
            <div className="table-wrap">
              <table className="tbl cards">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>รหัส</th>
                    <th>ชื่อบัญชี</th>
                    <th>บรรทัดในงบการเงิน</th>
                    <th style={{ width: 150 }}>ประเภท</th>
                    <th className="num" style={{ width: 90 }}>จำนวนรายการ</th>
                    <th className="num" style={{ width: 140 }}>ยอดคงเหลือ</th>
                    {canManage && <th style={{ width: 110 }}>จัดการ</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.account_code} style={{ opacity: r.is_active ? 1 : 0.45 }}>
                      <td data-label="รหัส" className="code">{r.account_code}</td>
                      <td data-label="ชื่อบัญชี" style={{ fontWeight: r.allow_posting ? 400 : 600 }}>{r.account_name}</td>
                      <td data-label="บรรทัดในงบการเงิน" className="muted" style={{ fontSize: 12 }}>{r.npae_report_line ?? '—'}</td>
                      <td data-label="ประเภท">
                        {!r.allow_posting && <span className="badge plain">บัญชีคุม</span>}
                        {r.is_contra && <span className="badge warn" style={{ marginLeft: 4 }}>ปรับมูลค่า</span>}
                        {!r.is_active && <span className="badge danger" style={{ marginLeft: 4 }}>ปิดใช้งาน</span>}
                      </td>
                      <td data-label="จำนวนรายการ" className="num muted">{r.line_count}</td>
                      <td data-label="ยอดคงเหลือ" className="num">{Number(r.balance) === 0 ? '—' : baht(r.balance)}</td>
                      {canManage && (
                        <td data-label="จัดการ">
                          <ToggleButton id={r.id} active={r.is_active} action={toggleAccount} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </>
  )
}
