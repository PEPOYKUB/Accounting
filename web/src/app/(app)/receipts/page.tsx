import Link from 'next/link'
import { q } from '@/lib/db'
import { baht, thaiDate } from '@/lib/money'

export const dynamic = 'force-dynamic'

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>
}) {
  const sp = await searchParams
  const rows = await q<{
    id: string; doc_no: string; partner_name: string; receipt_date: string
    tax_invoice_no: string | null; gross_amount: string; wht_amount: string
    net_received: string; journal_entry_id: string | null; entry_no: string | null; invoices: string
  }>(`
    SELECT r.id::text, r.doc_no, p.partner_name, r.receipt_date::text, r.tax_invoice_no,
           r.gross_amount::text, r.wht_amount::text, r.net_received::text,
           r.journal_entry_id::text, je.entry_no,
           COALESCE((SELECT string_agg(i.doc_no, ', ' ORDER BY i.doc_no)
                       FROM acc.ar_receipt_allocations a
                       JOIN acc.ar_invoices i ON i.id = a.invoice_id
                      WHERE a.receipt_id = r.id), '') AS invoices
      FROM acc.ar_receipts r
      JOIN acc.business_partners p ON p.id = r.customer_id
      LEFT JOIN acc.journal_entries je ON je.id = r.journal_entry_id
     ORDER BY r.receipt_date DESC, r.id DESC`)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>รับชำระเงิน</h1>
          <p>ใบเสร็จรับเงินและใบกำกับภาษี — จุดที่ภาษีขายถึงกำหนดนำส่ง</p>
        </div>
        <Link className="btn primary" href="/receipts/new">+ รับชำระเงิน</Link>
      </div>

      {sp.created && (
        <div className="alert ok">
          <div>บันทึกการรับชำระ <strong>{sp.created}</strong> และลงบัญชีเรียบร้อยแล้ว</div>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? (
            <div className="empty">ยังไม่มีการรับชำระเงิน</div>
          ) : (
            <table className="tbl cards">
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th>ลูกค้า</th>
                  <th>วันที่</th>
                  <th>เลขใบกำกับภาษี</th>
                  <th>ตัดใบแจ้งหนี้</th>
                  <th className="num">ยอดตัดหนี้</th>
                  <th className="num">ถูกหัก ณ ที่จ่าย</th>
                  <th className="num">เงินเข้าจริง</th>
                  <th>ใบสำคัญ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="เลขที่" className="code card-title">{r.doc_no}</td>
                    <td data-label="ลูกค้า">{r.partner_name}</td>
                    <td data-label="วันที่" className="nowrap">{thaiDate(r.receipt_date)}</td>
                    <td data-label="เลขใบกำกับภาษี" className="code">{r.tax_invoice_no ?? '—'}</td>
                    <td data-label="ตัดใบแจ้งหนี้" className="code">{r.invoices || '—'}</td>
                    <td data-label="ยอดตัดหนี้" className="num">{baht(r.gross_amount)}</td>
                    <td data-label="ถูกหัก ณ ที่จ่าย" className="num">{baht(r.wht_amount)}</td>
                    <td data-label="เงินเข้าจริง" className="num">{baht(r.net_received)}</td>
                    <td data-label="ใบสำคัญ" className="code">
                      {r.journal_entry_id ? (
                        <Link href={`/journal/${r.journal_entry_id}`}>{r.entry_no}</Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
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
