import { q } from '@/lib/db'
import { baht, thaiDate } from '@/lib/money'

export const dynamic = 'force-dynamic'

const BUCKETS = ['CURRENT', '1-30', '31-60', '61-90', '90+'] as const
const BUCKET_TH: Record<string, string> = {
  CURRENT: 'ยังไม่ครบกำหนด',
  '1-30': 'เกิน 1-30 วัน',
  '31-60': 'เกิน 31-60 วัน',
  '61-90': 'เกิน 61-90 วัน',
  '90+': 'เกิน 90 วัน',
}

export default async function ArAgingPage() {
  const rows = await q<{
    partner_name: string; doc_no: string; issue_date: string; due_date: string
    balance_due: string; days_overdue: string; aging_bucket: string
  }>(`
    SELECT partner_name, doc_no, issue_date::text, due_date::text,
           balance_due::text, days_overdue::text, aging_bucket
      FROM acc.v_ar_aging
     ORDER BY partner_name, due_date`)

  const byCustomer = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = byCustomer.get(r.partner_name) ?? []
    list.push(r)
    byCustomer.set(r.partner_name, list)
  }

  const bucketTotal = (b: string) =>
    rows.filter((r) => r.aging_bucket === b).reduce((a, r) => a + Number(r.balance_due), 0)
  const grand = rows.reduce((a, r) => a + Number(r.balance_due), 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>รายงานอายุลูกหนี้</h1>
          <p>ลูกหนี้คงค้างทั้งหมด {baht(grand)} บาท จาก {rows.length} ใบแจ้งหนี้</p>
        </div>
      </div>

      <div className="grid c4" style={{ marginBottom: 14 }}>
        {BUCKETS.map((b) => {
          const v = bucketTotal(b)
          return (
            <div className="card stat" key={b}>
              <div className="label">{BUCKET_TH[b]}</div>
              <div className="value" style={{ color: b === 'CURRENT' ? undefined : 'var(--danger)' }}>
                {baht(v)}
              </div>
              <div className="sub">
                {grand > 0 ? `${((v / grand) * 100).toFixed(1)}% ของยอดคงค้าง` : '—'}
              </div>
            </div>
          )
        })}
      </div>

      <div className="card">
        <div className="card-head">รายละเอียดรายลูกค้า</div>
        <div className="table-wrap">
          {rows.length === 0 ? (
            <div className="empty">ไม่มีลูกหนี้คงค้าง</div>
          ) : (
            <table className="tbl cards">
              <thead>
                <tr>
                  <th>ลูกค้า / เลขที่</th>
                  <th>วันที่</th>
                  <th>ครบกำหนด</th>
                  <th className="num">เกินกำหนด (วัน)</th>
                  <th>ช่วงอายุ</th>
                  <th className="num">คงค้าง</th>
                </tr>
              </thead>
              <tbody>
                {[...byCustomer.entries()].map(([name, items]) => (
                  <>
                    <tr className="group" key={name}>
                      <td colSpan={5}>{name}</td>
                      <td data-label="คงค้าง" className="num">
                        {baht(items.reduce((a, r) => a + Number(r.balance_due), 0))}
                      </td>
                    </tr>
                    {items.map((r) => (
                      <tr key={r.doc_no}>
                        <td data-label="ลูกค้า / เลขที่" style={{ paddingLeft: 26 }} className="code">{r.doc_no}</td>
                        <td data-label="วันที่" className="nowrap">{thaiDate(r.issue_date)}</td>
                        <td data-label="ครบกำหนด" className="nowrap">{thaiDate(r.due_date)}</td>
                        <td data-label="เกินกำหนด (วัน)" className="num">{Number(r.days_overdue) > 0 ? r.days_overdue : '—'}</td>
                        <td data-label="ช่วงอายุ">
                          <span className={`badge ${r.aging_bucket === 'CURRENT' ? 'ok' : 'danger'}`}>
                            {BUCKET_TH[r.aging_bucket]}
                          </span>
                        </td>
                        <td data-label="คงค้าง" className="num">{baht(r.balance_due)}</td>
                      </tr>
                    ))}
                  </>
                ))}
                <tr className="total">
                  <td colSpan={5}>รวมทั้งสิ้น</td>
                  <td className="num">{baht(grand)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
