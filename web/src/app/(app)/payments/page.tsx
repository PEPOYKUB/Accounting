import Link from 'next/link'
import { q } from '@/lib/db'
import { baht, thaiDate } from '@/lib/money'
import { WHT_FORM_TH } from '@/lib/labels'

export const dynamic = 'force-dynamic'

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>
}) {
  const sp = await searchParams
  const rows = await q<{
    id: string; doc_no: string; partner_name: string; payment_date: string
    gross_amount: string; wht_amount: string; net_paid: string
    journal_entry_id: string | null; entry_no: string | null; bills: string
    wht_docs: string | null; wht_form: string | null
  }>(`
    SELECT pay.id::text, pay.doc_no, p.partner_name, pay.payment_date::text,
           pay.gross_amount::text, pay.wht_amount::text, pay.net_paid::text,
           pay.journal_entry_id::text, je.entry_no,
           COALESCE((SELECT string_agg(b.doc_no, ', ' ORDER BY b.doc_no)
                       FROM acc.ap_payment_allocations a
                       JOIN acc.ap_bills b ON b.id = a.bill_id
                      WHERE a.payment_id = pay.id), '') AS bills,
           (SELECT string_agg(w.doc_no, ', ') FROM acc.wht_certificates w WHERE w.payment_id = pay.id) AS wht_docs,
           (SELECT MIN(w.wht_form::text) FROM acc.wht_certificates w WHERE w.payment_id = pay.id) AS wht_form
      FROM acc.ap_payments pay
      JOIN acc.business_partners p ON p.id = pay.vendor_id
      LEFT JOIN acc.journal_entries je ON je.id = pay.journal_entry_id
     ORDER BY pay.payment_date DESC, pay.id DESC`)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>จ่ายชำระ</h1>
          <p>ใบสำคัญจ่ายและหนังสือรับรองหักภาษี ณ ที่จ่าย</p>
        </div>
        <Link className="btn primary" href="/payments/new">+ จ่ายชำระ</Link>
      </div>

      {sp.created && (
        <div className="alert ok">
          <div>บันทึกการจ่ายชำระ <strong>{sp.created}</strong> และลงบัญชีเรียบร้อยแล้ว</div>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? (
            <div className="empty">ยังไม่มีการจ่ายชำระ</div>
          ) : (
            <table className="tbl cards">
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th>ผู้ขาย</th>
                  <th>วันที่</th>
                  <th>ตัดใบตั้งหนี้</th>
                  <th className="num">ยอดตัดหนี้</th>
                  <th className="num">หัก ณ ที่จ่าย</th>
                  <th className="num">จ่ายจริง</th>
                  <th>หนังสือรับรอง</th>
                  <th>ใบสำคัญ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="เลขที่" className="code card-title">{r.doc_no}</td>
                    <td data-label="ผู้ขาย">{r.partner_name}</td>
                    <td data-label="วันที่" className="nowrap">{thaiDate(r.payment_date)}</td>
                    <td data-label="ตัดใบตั้งหนี้" className="code">{r.bills || '—'}</td>
                    <td data-label="ยอดตัดหนี้" className="num">{baht(r.gross_amount)}</td>
                    <td data-label="หัก ณ ที่จ่าย" className="num">{baht(r.wht_amount)}</td>
                    <td data-label="จ่ายจริง" className="num">{baht(r.net_paid)}</td>
                    <td data-label="หนังสือรับรอง" className="code">
                      {r.wht_docs ? (
                        <>
                          {r.wht_docs}
                          {r.wht_form && (
                            <div className="muted" style={{ fontSize: 11 }}>
                              {WHT_FORM_TH[r.wht_form] ?? r.wht_form}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
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
