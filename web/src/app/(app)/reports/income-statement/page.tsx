import { q } from '@/lib/db'
import { baht, thaiPeriod, thaiDate } from '@/lib/money'
import { listPeriods, workingPeriod } from '@/lib/queries'
import PeriodPicker from '@/components/PeriodPicker'

export const dynamic = 'force-dynamic'

type Row = {
  account_code: string
  account_name: string
  account_type: string
  subtype: string | null
  report_line: string | null
  period_amount: string
  ytd_amount: string
}

export default async function IncomeStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const sp = await searchParams
  const periods = await listPeriods()
  const fallback = await workingPeriod()
  const periodId = sp.period ?? fallback?.id ?? periods[0]?.id
  const period = periods.find((p) => p.id === periodId)

  // ตัดรายการปิดบัญชีออก มิฉะนั้นรายได้/ค่าใช้จ่ายจะกลายเป็นศูนย์หลังปิดปี
  const rows: Row[] = periodId
    ? await q<Row>(
        `WITH tgt AS (SELECT start_date, end_date,
                             (SELECT start_date FROM acc.fiscal_years f
                               WHERE f.id = p.fiscal_year_id) AS fy_start
                        FROM acc.accounting_periods p WHERE p.id = $1::bigint)
         SELECT a.account_code, a.account_name, a.account_type::text,
                a.account_subtype AS subtype, a.npae_report_line AS report_line,
                COALESCE(SUM(CASE WHEN je.entry_date BETWEEN t.start_date AND t.end_date
                                  THEN CASE WHEN a.account_type = 'REVENUE'
                                            THEN l.credit_amount - l.debit_amount
                                            ELSE l.debit_amount - l.credit_amount END
                                  ELSE 0 END), 0)::text AS period_amount,
                COALESCE(SUM(CASE WHEN a.account_type = 'REVENUE'
                                  THEN l.credit_amount - l.debit_amount
                                  ELSE l.debit_amount - l.credit_amount END), 0)::text AS ytd_amount
           FROM acc.chart_of_accounts a
           JOIN acc.journal_entry_lines l ON l.account_id = a.id
           JOIN acc.journal_entries je ON je.id = l.journal_entry_id
           CROSS JOIN tgt t
          WHERE je.status = 'POSTED'
            AND je.source_type <> 'CLOSING'
            AND a.account_type IN ('REVENUE','EXPENSE')
            AND je.entry_date BETWEEN t.fy_start AND t.end_date
          GROUP BY a.account_code, a.account_name, a.account_type, a.account_subtype, a.npae_report_line
         HAVING COALESCE(SUM(CASE WHEN a.account_type = 'REVENUE'
                                  THEN l.credit_amount - l.debit_amount
                                  ELSE l.debit_amount - l.credit_amount END), 0) <> 0
          ORDER BY a.account_code`,
        [periodId]
      )
    : []

  const section = (pred: (r: Row) => boolean) => rows.filter(pred)
  const total = (rs: Row[], k: 'period_amount' | 'ytd_amount') =>
    rs.reduce((a, r) => a + Number(r[k]), 0)

  const revenue = section((r) => r.account_type === 'REVENUE' && r.subtype !== 'OTHER_INCOME')
  const otherIncome = section((r) => r.subtype === 'OTHER_INCOME')
  const cos = section((r) => r.subtype === 'COST_OF_SERVICE')
  const sga = section((r) => r.subtype === 'SGA')
  const finance = section((r) => r.subtype === 'FINANCE_COST')
  const tax = section((r) => r.subtype === 'INCOME_TAX')

  const Block = ({ title, rs }: { title: string; rs: Row[] }) =>
    rs.length === 0 ? null : (
      <>
        <tr className="group">
          <td colSpan={3}>{title}</td>
        </tr>
        {rs.map((r) => (
          <tr key={r.account_code}>
            <td style={{ paddingLeft: 26 }}>
              <span className="code">{r.account_code}</span> {r.account_name}
            </td>
            <td className="num">{baht(r.period_amount, { blankZero: true })}</td>
            <td className="num">{baht(r.ytd_amount, { blankZero: true })}</td>
          </tr>
        ))}
      </>
    )

  const Total = ({ label, p, y, strong }: { label: string; p: number; y: number; strong?: boolean }) => (
    <tr className={strong ? 'total' : ''} style={strong ? undefined : { fontWeight: 600 }}>
      <td>{label}</td>
      <td className="num">{baht(p)}</td>
      <td className="num">{baht(y)}</td>
    </tr>
  )

  const revP = total(revenue, 'period_amount'), revY = total(revenue, 'ytd_amount')
  const cosP = total(cos, 'period_amount'), cosY = total(cos, 'ytd_amount')
  const sgaP = total(sga, 'period_amount'), sgaY = total(sga, 'ytd_amount')
  const othP = total(otherIncome, 'period_amount'), othY = total(otherIncome, 'ytd_amount')
  const finP = total(finance, 'period_amount'), finY = total(finance, 'ytd_amount')
  const taxP = total(tax, 'period_amount'), taxY = total(tax, 'ytd_amount')

  const grossP = revP - cosP, grossY = revY - cosY
  const opP = grossP - sgaP, opY = grossY - sgaY
  const netP = opP + othP - finP - taxP
  const netY = opY + othY - finY - taxY

  return (
    <>
      <div className="page-head">
        <div>
          <h1>งบกำไรขาดทุน</h1>
          <p>
            รูปแบบตาม TFRS for NPAEs · ไม่รวมรายการปิดบัญชี
            {period && ` · สะสมตั้งแต่ต้นปีบัญชีถึง ${thaiDate(period.end_date)}`}
          </p>
        </div>
        <PeriodPicker periods={periods} selected={periodId ?? ''} />
      </div>

      <div className="card">
        <div className="card-head">
          <span>งวด {thaiPeriod(period?.period_name)}</span>
          <span className={`badge ${netY >= 0 ? 'ok' : 'danger'}`}>
            {netY >= 0 ? 'กำไรสุทธิสะสม' : 'ขาดทุนสุทธิสะสม'} {baht(Math.abs(netY))}
          </span>
        </div>
        <div className="table-wrap">
          {rows.length === 0 ? (
            <div className="empty">ยังไม่มีรายได้หรือค่าใช้จ่ายในปีบัญชีนี้</div>
          ) : (
            <table className="tbl cards">
              <thead>
                <tr>
                  <th>รายการ</th>
                  <th className="num" style={{ width: 160 }}>งวดนี้</th>
                  <th className="num" style={{ width: 160 }}>สะสมทั้งปี</th>
                </tr>
              </thead>
              <tbody>
                <Block title="รายได้จากการให้บริการ" rs={revenue} />
                <Total label="รวมรายได้" p={revP} y={revY} />
                <Block title="ต้นทุนการให้บริการ" rs={cos} />
                {cos.length > 0 && <Total label="กำไรขั้นต้น" p={grossP} y={grossY} strong />}
                <Block title="ค่าใช้จ่ายในการขายและบริหาร" rs={sga} />
                <Total label="กำไรจากการดำเนินงาน" p={opP} y={opY} />
                <Block title="รายได้อื่น" rs={otherIncome} />
                <Block title="ต้นทุนทางการเงิน" rs={finance} />
                <Block title="ค่าใช้จ่ายภาษีเงินได้" rs={tax} />
                <Total label={netY >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ'} p={netP} y={netY} strong />
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
