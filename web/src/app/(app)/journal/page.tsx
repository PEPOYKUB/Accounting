import Link from 'next/link'
import { q } from '@/lib/db'
import { baht, thaiDate } from '@/lib/money'
import { SOURCE_TH } from '@/lib/labels'

export const dynamic = 'force-dynamic'

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; source?: string }>
}) {
  const sp = await searchParams
  const filter = sp.source ?? ''

  const rows = await q<{
    id: string; entry_no: string; entry_date: string; period_name: string
    source_type: string; description: string; status: string; amount: string
    reversed_by_entry_id: string | null; reverses_entry_id: string | null
    created_by_name: string; approved_by_name: string | null
  }>(
    `SELECT je.id::text, je.entry_no, je.entry_date::text, p.period_name,
            je.source_type::text, je.description, je.status::text,
            (SELECT COALESCE(SUM(debit_amount),0) FROM acc.journal_entry_lines
              WHERE journal_entry_id = je.id)::text AS amount,
            je.reversed_by_entry_id::text, je.reverses_entry_id::text,
            cu.full_name AS created_by_name, au.full_name AS approved_by_name
       FROM acc.journal_entries je
       JOIN acc.accounting_periods p ON p.id = je.period_id
       JOIN acc.app_users cu ON cu.id = je.created_by
       LEFT JOIN acc.app_users au ON au.id = je.approved_by
      WHERE ($1 = '' OR je.source_type::text = $1)
      ORDER BY je.entry_date DESC, je.id DESC
      LIMIT 200`,
    [filter]
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>สมุดรายวันทั่วไป</h1>
          <p>ศูนย์กลางของระบบ — ยอดทุกบาทในทุกรายงานมาจากที่นี่</p>
        </div>
        <Link className="btn primary" href="/journal/new">+ ลงบัญชีมือ</Link>
      </div>

      {sp.created && (
        <div className="alert ok">
          <div>ลงบัญชีใบสำคัญ <strong>{sp.created}</strong> เรียบร้อยแล้ว</div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <span>รายการล่าสุด {rows.length} ใบ</span>
          <div className="toolbar">
            <Link className={`btn sm${filter === '' ? ' primary' : ''}`} href="/journal">ทั้งหมด</Link>
            {['SALES_INVOICE', 'SALES_RECEIPT', 'PURCHASE_BILL', 'PURCHASE_PAYMENT', 'MANUAL'].map((s) => (
              <Link key={s} className={`btn sm${filter === s ? ' primary' : ''}`} href={`/journal?source=${s}`}>
                {SOURCE_TH[s]}
              </Link>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          {rows.length === 0 ? (
            <div className="empty">ยังไม่มีรายการบัญชี</div>
          ) : (
            <table className="tbl cards">
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th>วันที่</th>
                  <th>งวด</th>
                  <th>ที่มา</th>
                  <th>คำอธิบาย</th>
                  <th className="num">จำนวนเงิน</th>
                  <th>ผู้บันทึก / ผู้อนุมัติ</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="เลขที่" className="code card-title"><Link href={`/journal/${r.id}`}>{r.entry_no}</Link></td>
                    <td data-label="วันที่" className="nowrap">{thaiDate(r.entry_date)}</td>
                    <td data-label="งวด" className="code">{r.period_name}</td>
                    <td data-label="ที่มา"><span className="badge plain">{SOURCE_TH[r.source_type] ?? r.source_type}</span></td>
                    <td data-label="คำอธิบาย">
                      {r.description}
                      {r.reverses_entry_id && <span className="badge warn" style={{ marginLeft: 6 }}>ใบกลับรายการ</span>}
                      {r.reversed_by_entry_id && <span className="badge danger" style={{ marginLeft: 6 }}>ถูกกลับรายการแล้ว</span>}
                    </td>
                    <td data-label="จำนวนเงิน" className="num">{baht(r.amount)}</td>
                    <td data-label="ผู้บันทึก / ผู้อนุมัติ" style={{ fontSize: 12 }} className="muted">
                      {r.created_by_name}
                      {r.approved_by_name ? ` / ${r.approved_by_name}` : ''}
                    </td>
                    <td data-label="สถานะ">
                      <span className={`badge ${r.status === 'POSTED' ? 'ok' : r.status === 'DRAFT' ? 'warn' : 'danger'}`}>
                        {r.status === 'POSTED' ? 'ลงบัญชีแล้ว' : r.status === 'DRAFT' ? 'ร่าง' : 'ยกเลิก'}
                      </span>
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
