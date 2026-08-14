import { q } from '@/lib/db'
import { baht, thaiDate, thaiPeriod } from '@/lib/money'
import { PERIOD_STATUS_TH } from '@/lib/labels'
import { requireUser, can } from '@/lib/auth'
import ClosePeriodButton from '@/components/ClosePeriodButton'
import FiscalYearForm from '@/components/FiscalYearForm'
import ReopenPeriodButton from '@/components/ReopenPeriodButton'
import { one } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default async function PeriodsPage() {
  const me = await requireUser()
  const isController = can(me, 'period.close')

  const rows = await q<{
    id: string; period_name: string; start_date: string; end_date: string; status: string
    closed_by_name: string | null; closed_at: string | null
    entries: string; drafts: string; movement: string
  }>(`
    SELECT p.id::text, p.period_name, p.start_date::text, p.end_date::text, p.status::text,
           u.full_name AS closed_by_name, p.closed_at::text,
           COUNT(je.id) FILTER (WHERE je.status = 'POSTED')::text AS entries,
           COUNT(je.id) FILTER (WHERE je.status = 'DRAFT')::text  AS drafts,
           COALESCE((SELECT SUM(l.debit_amount)
                       FROM acc.journal_entry_lines l
                       JOIN acc.journal_entries j2 ON j2.id = l.journal_entry_id
                      WHERE j2.period_id = p.id AND j2.status = 'POSTED'), 0)::text AS movement
      FROM acc.accounting_periods p
      LEFT JOIN acc.journal_entries je ON je.period_id = p.id
      LEFT JOIN acc.app_users u ON u.id = p.closed_by
     GROUP BY p.id, p.period_name, p.start_date, p.end_date, p.status, u.full_name, p.closed_at
     ORDER BY p.start_date`)

  // แนะนำวันเริ่มต้นของปีบัญชีถัดไป = วันถัดจากวันสิ้นสุดของปีบัญชีล่าสุด
  const lastFy = await one<{ next_start: string; next_code: string }>(
    `SELECT (MAX(end_date) + 1)::text AS next_start,
            'FY' || to_char(MAX(end_date) + 1, 'YYYY') AS next_code
       FROM acc.fiscal_years`
  )
  const todayIso = new Date().toISOString().slice(0, 10)
  const suggestStart = lastFy?.next_start ?? todayIso.slice(0, 4) + '-01-01'
  const suggestCode = lastFy?.next_code ?? 'FY' + todayIso.slice(0, 4)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>งวดบัญชี</h1>
          <p>
            ปิดงวดแล้วจะลงบัญชีเพิ่มในงวดนั้นไม่ได้อีก — ระบบตรวจเช็กลิสต์ให้ก่อนอนุญาต
            (ไม่มีใบร่างค้าง · สมการบัญชีสมดุล · บัญชีคุมตรงกับบัญชีย่อย)
          </p>
        </div>
      </div>

      {!isController && (
        <div className="alert info">
          <div>
            ผู้ใช้ปัจจุบันไม่มีสิทธิ์ปิดงวด — เฉพาะผู้จัดการบัญชี (Controller) เท่านั้น
            สลับผู้ใช้ได้ที่แถบด้านบนขวา
          </div>
        </div>
      )}

      {isController && (
        <FiscalYearForm suggestedStart={suggestStart} suggestedCode={suggestCode} open={rows.length === 0} />
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="tbl cards">
            <thead>
              <tr>
                <th>งวด</th>
                <th>ช่วงวันที่</th>
                <th className="num">รายการที่ลงบัญชี</th>
                <th className="num">ใบร่างค้าง</th>
                <th className="num">ยอดเคลื่อนไหว</th>
                <th>สถานะ</th>
                <th>ปิดโดย</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = PERIOD_STATUS_TH[r.status] ?? { text: r.status, cls: 'plain' }
                const hasActivity = Number(r.entries) > 0 || Number(r.drafts) > 0
                return (
                  <tr key={r.id} style={{ opacity: hasActivity || r.status !== 'OPEN' ? 1 : 0.55 }}>
                    <td data-label="งวด"><strong>{thaiPeriod(r.period_name)}</strong></td>
                    <td data-label="ช่วงวันที่" className="nowrap muted" style={{ fontSize: 12 }}>
                      {thaiDate(r.start_date)} – {thaiDate(r.end_date)}
                    </td>
                    <td data-label="รายการที่ลงบัญชี" className="num">{r.entries}</td>
                    <td data-label="ใบร่างค้าง" className="num">
                      {Number(r.drafts) > 0
                        ? <span className="badge warn">{r.drafts}</span>
                        : <span className="muted">0</span>}
                    </td>
                    <td data-label="ยอดเคลื่อนไหว" className="num">{Number(r.movement) > 0 ? baht(r.movement) : '—'}</td>
                    <td data-label="สถานะ"><span className={`badge ${st.cls}`}>{st.text}</span></td>
                    <td data-label="ปิดโดย" className="muted" style={{ fontSize: 12 }}>
                      {r.closed_by_name ? `${r.closed_by_name} · ${thaiDate(r.closed_at?.slice(0, 10))}` : '—'}
                    </td>
                    <td>
                      {r.status === 'OPEN' && isController && hasActivity && (
                        <ClosePeriodButton periodId={r.id} periodLabel={thaiPeriod(r.period_name)} />
                      )}
                      {r.status === 'CLOSED' && isController && (
                        <ReopenPeriodButton periodId={r.id} periodLabel={thaiPeriod(r.period_name)} />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
