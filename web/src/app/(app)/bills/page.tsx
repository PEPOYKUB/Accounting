import Link from 'next/link'
import { q } from '@/lib/db'
import { baht, thaiDate } from '@/lib/money'
import { DOC_STATUS_TH } from '@/lib/labels'

export const dynamic = 'force-dynamic'

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>
}) {
  const sp = await searchParams
  const rows = await q<{
    id: string; doc_no: string; partner_name: string; bill_date: string; due_date: string
    subtotal: string; vat_amount: string; total_amount: string; balance_due: string
    vat_timing: string; status: string; journal_entry_id: string | null; entry_no: string | null
  }>(`
    SELECT b.id::text, b.doc_no, p.partner_name, b.bill_date::text, b.due_date::text,
           b.subtotal::text, b.vat_amount::text, b.total_amount::text, b.balance_due::text,
           b.vat_timing::text, b.status::text, b.journal_entry_id::text, je.entry_no
      FROM acc.ap_bills b
      JOIN acc.business_partners p ON p.id = b.vendor_id
      LEFT JOIN acc.journal_entries je ON je.id = b.journal_entry_id
     ORDER BY b.bill_date DESC, b.id DESC`)

  const totalOpen = rows.reduce((a, r) => a + Number(r.balance_due), 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ตั้งหนี้ผู้ขาย</h1>
          <p>ทั้งหมด {rows.length} ใบ · ค้างจ่าย {baht(totalOpen)} บาท</p>
        </div>
        <div className="toolbar">
          <Link className="btn" href="/payments/new">จ่ายชำระ</Link>
          <Link className="btn primary" href="/bills/new">+ ตั้งหนี้</Link>
        </div>
      </div>

      {sp.created && (
        <div className="alert ok">
          <div>ตั้งหนี้ <strong>{sp.created}</strong> และลงบัญชีเรียบร้อยแล้ว</div>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? (
            <div className="empty">ยังไม่มีใบตั้งหนี้</div>
          ) : (
            <table className="tbl cards">
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th>ผู้ขาย</th>
                  <th>วันที่</th>
                  <th>ครบกำหนด</th>
                  <th className="num">ก่อนภาษี</th>
                  <th className="num">VAT</th>
                  <th className="num">รวม</th>
                  <th className="num">ค้างจ่าย</th>
                  <th>ภาษีซื้อ</th>
                  <th>สถานะ</th>
                  <th>ใบสำคัญ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = DOC_STATUS_TH[r.status] ?? { text: r.status, cls: 'plain' }
                  return (
                    <tr key={r.id}>
                      <td data-label="เลขที่" className="code card-title">{r.doc_no}</td>
                      <td data-label="ผู้ขาย">{r.partner_name}</td>
                      <td data-label="วันที่" className="nowrap">{thaiDate(r.bill_date)}</td>
                      <td data-label="ครบกำหนด" className="nowrap">{thaiDate(r.due_date)}</td>
                      <td data-label="ก่อนภาษี" className="num">{baht(r.subtotal)}</td>
                      <td data-label="VAT" className="num">{baht(r.vat_amount)}</td>
                      <td data-label="รวม" className="num">{baht(r.total_amount)}</td>
                      <td data-label="ค้างจ่าย" className="num">{Number(r.balance_due) > 0 ? baht(r.balance_due) : '—'}</td>
                      <td data-label="ภาษีซื้อ">
                        <span className={`badge ${r.vat_timing === 'ON_INVOICE' ? 'info' : 'warn'}`}>
                          {r.vat_timing === 'ON_INVOICE' ? 'ใช้สิทธิแล้ว' : 'พักไว้'}
                        </span>
                      </td>
                      <td data-label="สถานะ"><span className={`badge ${st.cls}`}>{st.text}</span></td>
                      <td data-label="ใบสำคัญ" className="code">
                        {r.journal_entry_id ? (
                          <Link href={`/journal/${r.journal_entry_id}`}>{r.entry_no}</Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
