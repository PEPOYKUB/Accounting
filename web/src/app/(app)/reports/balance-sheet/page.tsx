import { q } from '@/lib/db'
import { baht, thaiDate, thaiPeriod } from '@/lib/money'
import { listPeriods, workingPeriod } from '@/lib/queries'
import PeriodPicker from '@/components/PeriodPicker'

export const dynamic = 'force-dynamic'

type Row = {
  account_code: string
  account_name: string
  account_type: string
  subtype: string | null
  balance: string
}

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const sp = await searchParams
  const periods = await listPeriods()
  const fallback = await workingPeriod()
  const periodId = sp.period ?? fallback?.id ?? periods[0]?.id
  const period = periods.find((p) => p.id === periodId)
  const asOf = period?.end_date

  const rows: Row[] = asOf
    ? await q<Row>(
        `SELECT a.account_code, a.account_name, a.account_type::text,
                a.account_subtype AS subtype,
                COALESCE(SUM(l.debit_amount - l.credit_amount), 0)::text AS balance
           FROM acc.chart_of_accounts a
           JOIN acc.journal_entry_lines l ON l.account_id = a.id
           JOIN acc.journal_entries je ON je.id = l.journal_entry_id
          WHERE je.status = 'POSTED' AND je.entry_date <= $1::date
            AND a.account_type IN ('ASSET','LIABILITY','EQUITY')
          GROUP BY a.account_code, a.account_name, a.account_type, a.account_subtype
         HAVING COALESCE(SUM(l.debit_amount - l.credit_amount), 0) <> 0
          ORDER BY a.account_code`,
        [asOf]
      )
    : []

  // กำไรขาดทุนที่ยังไม่ได้ปิดเข้ากำไรสะสม ต้องแสดงในส่วนของผู้ถือหุ้น
  // มิฉะนั้นงบจะไม่ balance ระหว่างงวดที่ยังไม่ปิดปี
  // กำไร = ผลรวม (เครดิต − เดบิต) ของทั้งรายได้และค่าใช้จ่าย
  // รายได้มียอดด้านเครดิตจึงเป็นบวก ค่าใช้จ่ายมียอดด้านเดบิตจึงเป็นลบ ผลลัพธ์คือกำไรสุทธิโดยตรง
  // รวมรายการปิดบัญชีด้วยโดยตั้งใจ — หลังปิดปีค่านี้จะเป็นศูนย์เองเพราะกำไรถูกโอนเข้ากำไรสะสมแล้ว
  const pl = asOf
    ? await q<{ v: string }>(
        `SELECT COALESCE(SUM(l.credit_amount - l.debit_amount), 0)::text AS v
           FROM acc.chart_of_accounts a
           JOIN acc.journal_entry_lines l ON l.account_id = a.id
           JOIN acc.journal_entries je ON je.id = l.journal_entry_id
          WHERE je.status = 'POSTED' AND je.entry_date <= $1::date
            AND a.account_type IN ('REVENUE','EXPENSE')`,
        [asOf]
      )
    : []
  const unclosedPL = Number(pl[0]?.v ?? 0)

  const assets = rows.filter((r) => r.account_type === 'ASSET')
  const currentAssets = assets.filter((r) => r.subtype !== 'FIXED_ASSET' && r.subtype !== 'INTANGIBLE')
  const nonCurrentAssets = assets.filter((r) => r.subtype === 'FIXED_ASSET' || r.subtype === 'INTANGIBLE')
  const liabilities = rows.filter((r) => r.account_type === 'LIABILITY')
  const currentLiab = liabilities.filter((r) => r.subtype !== 'NON_CURRENT_LIABILITY')
  const nonCurrentLiab = liabilities.filter((r) => r.subtype === 'NON_CURRENT_LIABILITY')
  const equity = rows.filter((r) => r.account_type === 'EQUITY')

  const sumDr = (rs: Row[]) => rs.reduce((a, r) => a + Number(r.balance), 0)
  const sumCr = (rs: Row[]) => rs.reduce((a, r) => a - Number(r.balance), 0)

  const totalAssets = sumDr(assets)
  const totalLiab = sumCr(liabilities)
  const totalEquity = sumCr(equity) + unclosedPL
  const diff = totalAssets - (totalLiab + totalEquity)

  const Section = ({
    title, rs, credit,
  }: { title: string; rs: Row[]; credit?: boolean }) =>
    rs.length === 0 ? null : (
      <>
        <tr className="group"><td colSpan={2}>{title}</td></tr>
        {rs.map((r) => (
          <tr key={r.account_code}>
            <td style={{ paddingLeft: 26 }}>
              <span className="code">{r.account_code}</span> {r.account_name}
            </td>
            <td className="num">{baht(credit ? -Number(r.balance) : r.balance)}</td>
          </tr>
        ))}
      </>
    )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>งบแสดงฐานะการเงิน</h1>
          <p>ณ วันที่ {thaiDate(asOf)} · รูปแบบตาม TFRS for NPAEs</p>
        </div>
        <PeriodPicker periods={periods} selected={periodId ?? ''} />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <span>สรุป ณ สิ้นงวด {thaiPeriod(period?.period_name)}</span>
          <span className={`badge ${diff === 0 ? 'ok' : 'danger'}`}>
            {diff === 0
              ? '● สินทรัพย์ = หนี้สิน + ส่วนของผู้ถือหุ้น'
              : `● ไม่สมดุล ผลต่าง ${baht(diff)}`}
          </span>
        </div>
      </div>

      <div className="grid c2">
        <div className="card">
          <div className="card-head">สินทรัพย์</div>
          <div className="table-wrap">
            <table className="tbl cards">
              <tbody>
                <Section title="สินทรัพย์หมุนเวียน" rs={currentAssets} />
                <Section title="สินทรัพย์ไม่หมุนเวียน" rs={nonCurrentAssets} />
                <tr className="total">
                  <td>รวมสินทรัพย์</td>
                  <td className="num">{baht(totalAssets)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">หนี้สินและส่วนของผู้ถือหุ้น</div>
          <div className="table-wrap">
            <table className="tbl cards">
              <tbody>
                <Section title="หนี้สินหมุนเวียน" rs={currentLiab} credit />
                <Section title="หนี้สินไม่หมุนเวียน" rs={nonCurrentLiab} credit />
                <tr style={{ fontWeight: 600 }}>
                  <td>รวมหนี้สิน</td>
                  <td className="num">{baht(totalLiab)}</td>
                </tr>
                <Section title="ส่วนของผู้ถือหุ้น" rs={equity} credit />
                {unclosedPL !== 0 && (
                  <tr>
                    <td style={{ paddingLeft: 26 }}>
                      {unclosedPL >= 0 ? 'กำไร' : 'ขาดทุน'}สุทธิระหว่างงวด (ยังไม่ปิดเข้ากำไรสะสม)
                    </td>
                    <td className="num">{baht(unclosedPL)}</td>
                  </tr>
                )}
                <tr style={{ fontWeight: 600 }}>
                  <td>รวมส่วนของผู้ถือหุ้น</td>
                  <td className="num">{baht(totalEquity)}</td>
                </tr>
                <tr className="total">
                  <td>รวมหนี้สินและส่วนของผู้ถือหุ้น</td>
                  <td className="num">{baht(totalLiab + totalEquity)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
