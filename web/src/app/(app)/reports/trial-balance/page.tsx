import { q } from '@/lib/db'
import { baht, thaiPeriod } from '@/lib/money'
import { listPeriods, workingPeriod } from '@/lib/queries'
import PeriodPicker from '@/components/PeriodPicker'

export const dynamic = 'force-dynamic'

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const sp = await searchParams
  const periods = await listPeriods()
  const fallback = await workingPeriod()
  const periodId = sp.period ?? fallback?.id ?? periods[0]?.id
  const period = periods.find((p) => p.id === periodId)

  const rows = periodId
    ? await q<{
        account_code: string; account_name: string; account_type: string
        opening_balance: string; period_debit: string; period_credit: string; closing_balance: string
      }>(
        `SELECT account_code, account_name, account_type::text,
                opening_balance::text, period_debit::text, period_credit::text, closing_balance::text
           FROM acc.fn_trial_balance($1::bigint)
          ORDER BY account_code`,
        [periodId]
      )
    : []

  const sum = (k: 'period_debit' | 'period_credit') => rows.reduce((a, r) => a + Number(r[k]), 0)
  const dr = sum('period_debit')
  const cr = sum('period_credit')
  const closingDr = rows.reduce((a, r) => a + Math.max(Number(r.closing_balance), 0), 0)
  const closingCr = rows.reduce((a, r) => a + Math.max(-Number(r.closing_balance), 0), 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>งบทดลอง</h1>
          <p>ยอดยกมา + เคลื่อนไหวในงวด + ยอดคงเหลือ ทุกบัญชีที่มีรายการ</p>
        </div>
        <PeriodPicker periods={periods} selected={periodId ?? ''} />
      </div>

      <div className="card">
        <div className="card-head">
          <span>งวด {thaiPeriod(period?.period_name)}</span>
          <span className={`badge ${dr === cr && closingDr === closingCr ? 'ok' : 'danger'}`}>
            {dr === cr && closingDr === closingCr ? '● เดบิตเท่ากับเครดิต' : '● ไม่สมดุล'}
          </span>
        </div>
        <div className="table-wrap">
          {rows.length === 0 ? (
            <div className="empty">งวดนี้ยังไม่มีรายการบัญชี</div>
          ) : (
            <table className="tbl cards">
              <thead>
                <tr>
                  <th style={{ width: 80 }}>รหัส</th>
                  <th>ชื่อบัญชี</th>
                  <th className="num">ยอดยกมา</th>
                  <th className="num">เดบิต</th>
                  <th className="num">เครดิต</th>
                  <th className="num">คงเหลือ (Dr)</th>
                  <th className="num">คงเหลือ (Cr)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const close = Number(r.closing_balance)
                  return (
                    <tr key={r.account_code}>
                      <td data-label="รหัส" className="code">{r.account_code}</td>
                      <td data-label="ชื่อบัญชี">{r.account_name}</td>
                      <td data-label="ยอดยกมา" className="num muted">{baht(r.opening_balance, { blankZero: true })}</td>
                      <td data-label="เดบิต" className="num">{baht(r.period_debit, { blankZero: true })}</td>
                      <td data-label="เครดิต" className="num">{baht(r.period_credit, { blankZero: true })}</td>
                      <td data-label="คงเหลือ (Dr)" className="num">{close > 0 ? baht(close) : ''}</td>
                      <td data-label="คงเหลือ (Cr)" className="num">{close < 0 ? baht(-close) : ''}</td>
                    </tr>
                  )
                })}
                <tr className="total">
                  <td colSpan={3}>รวม</td>
                  <td className="num">{baht(dr)}</td>
                  <td className="num">{baht(cr)}</td>
                  <td className="num">{baht(closingDr)}</td>
                  <td className="num">{baht(closingCr)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
