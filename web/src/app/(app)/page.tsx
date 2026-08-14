import Link from 'next/link'
import { q, one } from '@/lib/db'
import { baht, thaiDate, thaiPeriod } from '@/lib/money'
import { workingPeriod, healthCheck } from '@/lib/queries'
import { SOURCE_TH } from '@/lib/labels'
import { requireUser, can } from '@/lib/auth'
import SetupChecklist from '@/components/SetupChecklist'

export const dynamic = 'force-dynamic'

async function ConnectionError({ message }: { message: string }) {
  return (
    <>
      <div className="page-head">
        <div><h1>แดชบอร์ด</h1></div>
      </div>
      <div className="alert err">
        <div>
          <strong>เชื่อมต่อฐานข้อมูลไม่ได้</strong>
          <div style={{ marginTop: 6 }} className="mono">{message}</div>
          <div style={{ marginTop: 10 }}>
            ตรวจว่าฐานข้อมูลทำงานอยู่ด้วยคำสั่ง <code className="mono">docker compose up -d</code> ที่โฟลเดอร์โปรเจกต์
            แล้วรีเฟรชหน้านี้อีกครั้ง
          </div>
        </div>
      </div>
    </>
  )
}

export default async function Dashboard() {
  const me = await requireUser()
  let period, health, cash, ar, ap, tax, pl, openInvoices, recent

  try {
    period = await workingPeriod()
    health = await healthCheck()

    cash = await one<{ v: string }>(`
      SELECT COALESCE(SUM(l.debit_amount - l.credit_amount), 0)::text AS v
        FROM acc.journal_entry_lines l
        JOIN acc.journal_entries je ON je.id = l.journal_entry_id
        JOIN acc.chart_of_accounts a ON a.id = l.account_id
       WHERE je.status = 'POSTED' AND a.cashflow_category = 'CASH'`)

    ar = await one<{ v: string; n: string }>(`
      SELECT COALESCE(SUM(balance_due),0)::text AS v, COUNT(*)::text AS n
        FROM acc.ar_invoices WHERE balance_due > 0 AND status NOT IN ('DRAFT','CANCELLED')`)

    ap = await one<{ v: string; n: string }>(`
      SELECT COALESCE(SUM(balance_due),0)::text AS v, COUNT(*)::text AS n
        FROM acc.ap_bills WHERE balance_due > 0 AND status NOT IN ('DRAFT','CANCELLED')`)

    // ภาระภาษีคงค้าง = ภาษีขาย - ภาษีซื้อ + WHT ค้างนำส่ง + ปกส. ค้างนำส่ง
    tax = await one<{ vat: string; wht: string }>(`
      SELECT
        COALESCE(SUM(CASE WHEN a.account_code IN ('2100','2110') THEN l.credit_amount - l.debit_amount
                          WHEN a.account_code = '1150'          THEN l.credit_amount - l.debit_amount
                          ELSE 0 END), 0)::text AS vat,
        COALESCE(SUM(CASE WHEN a.account_code IN ('2200','2201','2202','2210')
                          THEN l.credit_amount - l.debit_amount ELSE 0 END), 0)::text AS wht
        FROM acc.journal_entry_lines l
        JOIN acc.journal_entries je ON je.id = l.journal_entry_id
        JOIN acc.chart_of_accounts a ON a.id = l.account_id
       WHERE je.status = 'POSTED'`)

    pl = period
      ? await one<{ revenue: string; expense: string }>(`
          SELECT
            COALESCE(SUM(CASE WHEN a.account_type = 'REVENUE' THEN l.credit_amount - l.debit_amount ELSE 0 END),0)::text AS revenue,
            COALESCE(SUM(CASE WHEN a.account_type = 'EXPENSE' THEN l.debit_amount - l.credit_amount ELSE 0 END),0)::text AS expense
            FROM acc.journal_entry_lines l
            JOIN acc.journal_entries je ON je.id = l.journal_entry_id
            JOIN acc.chart_of_accounts a ON a.id = l.account_id
           WHERE je.status = 'POSTED' AND je.period_id = $1::bigint
             AND je.source_type <> 'CLOSING'`, [period.id])
      : null

    openInvoices = await q<{
      doc_no: string; partner_name: string; due_date: string; balance_due: string; aging_bucket: string
    }>(`
      SELECT i.doc_no, p.partner_name, i.due_date::text, i.balance_due::text,
             CASE WHEN CURRENT_DATE <= i.due_date THEN 'CURRENT'
                  WHEN CURRENT_DATE - i.due_date <= 30 THEN '1-30'
                  WHEN CURRENT_DATE - i.due_date <= 60 THEN '31-60'
                  WHEN CURRENT_DATE - i.due_date <= 90 THEN '61-90'
                  ELSE '90+' END AS aging_bucket
        FROM acc.ar_invoices i JOIN acc.business_partners p ON p.id = i.customer_id
       WHERE i.balance_due > 0 AND i.status NOT IN ('DRAFT','CANCELLED')
       ORDER BY i.due_date LIMIT 6`)

    recent = await q<{
      id: string; entry_no: string; entry_date: string; description: string
      source_type: string; amount: string
    }>(`
      SELECT je.id::text, je.entry_no, je.entry_date::text, je.description, je.source_type::text,
             (SELECT COALESCE(SUM(debit_amount),0) FROM acc.journal_entry_lines WHERE journal_entry_id = je.id)::text AS amount
        FROM acc.journal_entries je
       WHERE je.status = 'POSTED'
       ORDER BY je.entry_date DESC, je.id DESC LIMIT 8`)
  } catch (err) {
    return <ConnectionError message={(err as Error).message} />
  }

  const outOfBalance = Number(health.eq?.out_of_balance ?? 0)
  const worstControl = Math.max(0, ...health.control.map((c) => Math.abs(Number(c.difference))))
  const netProfit = Number(pl?.revenue ?? 0) - Number(pl?.expense ?? 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>แดชบอร์ด</h1>
          <p>
            งวดที่ทำงานอยู่: <strong>{thaiPeriod(period?.period_name)}</strong>{' '}
            {period && (
              <span className={`badge ${period.status === 'OPEN' ? 'ok' : 'plain'}`}>
                {period.status === 'OPEN' ? 'เปิดอยู่' : period.status === 'CLOSED' ? 'ปิดแล้ว' : 'ล็อกถาวร'}
              </span>
            )}
          </p>
        </div>
        <div className="toolbar">
          <Link className="btn primary" href="/invoices/new">+ ใบแจ้งหนี้</Link>
          <Link className="btn" href="/bills/new">+ ตั้งหนี้</Link>
          <Link className="btn" href="/journal/new">+ ลงบัญชีมือ</Link>
        </div>
      </div>

      <SetupChecklist canManage={can(me, 'coa.manage')} />

      {/* ---- เครื่องมือเตือนภัย 2 ตัว ---- */}
      {(outOfBalance !== 0 || worstControl !== 0) && (
        <div className="alert err">
          <div>
            <strong>ตรวจพบความไม่สมดุลในระบบ — ต้องแก้ก่อนปิดงวด</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {outOfBalance !== 0 && (
                <li>สมการบัญชีไม่สมดุล ผลต่าง {baht(health.eq?.out_of_balance)} บาท</li>
              )}
              {health.control
                .filter((c) => Number(c.difference) !== 0)
                .map((c) => (
                  <li key={c.control_account}>
                    บัญชีคุม{c.control_account}ไม่ตรงกับบัญชีย่อย — แยกประเภท {baht(c.gl_balance)} /
                    บัญชีย่อย {baht(c.sub_balance)} (ต่าง {baht(c.difference)})
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}

      <div className="grid c4" style={{ marginBottom: 14 }}>
        <div className="card stat">
          <div className="label">เงินสดและเงินฝากธนาคาร</div>
          <div className="value">{baht(cash?.v)}</div>
          <div className="sub">ยอดคงเหลือปัจจุบัน</div>
        </div>
        <div className="card stat">
          <div className="label">ลูกหนี้คงค้าง</div>
          <div className="value">{baht(ar?.v)}</div>
          <div className="sub">{ar?.n ?? 0} ใบแจ้งหนี้ที่ยังไม่ได้รับชำระ</div>
        </div>
        <div className="card stat">
          <div className="label">เจ้าหนี้คงค้าง</div>
          <div className="value">{baht(ap?.v)}</div>
          <div className="sub">{ap?.n ?? 0} ใบตั้งหนี้ที่ยังไม่ได้จ่าย</div>
        </div>
        <div className="card stat">
          <div className="label">ภาษีและเงินนำส่งค้างจ่าย</div>
          <div className="value">{baht(Number(tax?.vat ?? 0) + Number(tax?.wht ?? 0))}</div>
          <div className="sub">
            VAT {baht(tax?.vat)} · หัก ณ ที่จ่าย/ปกส. {baht(tax?.wht)}
          </div>
        </div>
      </div>

      <div className="grid c2">
        <div className="card">
          <div className="card-head">
            ผลการดำเนินงาน {thaiPeriod(period?.period_name)}
            <Link className="btn sm" href="/reports/income-statement">ดูงบเต็ม</Link>
          </div>
          <div className="card-body">
            <table className="tbl">
              <tbody>
                <tr>
                  <td>รายได้</td>
                  <td className="num">{baht(pl?.revenue)}</td>
                </tr>
                <tr>
                  <td>ค่าใช้จ่าย</td>
                  <td className="num">({baht(pl?.expense)})</td>
                </tr>
                <tr className="total">
                  <td>{netProfit >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ'}</td>
                  <td className="num" style={{ color: netProfit >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                    {baht(Math.abs(netProfit))}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 11.5, marginBottom: 0, marginTop: 10 }}>
              ไม่รวมรายการปิดบัญชี · ตัวเลขมาจากสมุดรายวันโดยตรง
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            ใบแจ้งหนี้ที่ยังไม่ได้รับชำระ
            <Link className="btn sm" href="/reports/ar-aging">รายงานอายุลูกหนี้</Link>
          </div>
          <div className="table-wrap">
            {openInvoices.length === 0 ? (
              <div className="empty">ไม่มีลูกหนี้คงค้าง</div>
            ) : (
              <table className="tbl cards">
                <thead>
                  <tr>
                    <th>เลขที่</th>
                    <th>ลูกค้า</th>
                    <th>ครบกำหนด</th>
                    <th className="num">คงค้าง</th>
                  </tr>
                </thead>
                <tbody>
                  {openInvoices.map((r) => (
                    <tr key={r.doc_no}>
                      <td data-label="เลขที่" className="code card-title">{r.doc_no}</td>
                      <td data-label="ลูกค้า">{r.partner_name}</td>
                      <td data-label="ครบกำหนด" className="nowrap">
                        {thaiDate(r.due_date)}{' '}
                        {r.aging_bucket !== 'CURRENT' && (
                          <span className="badge danger">เกิน {r.aging_bucket} วัน</span>
                        )}
                      </td>
                      <td data-label="คงค้าง" className="num">{baht(r.balance_due)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          รายการบัญชีล่าสุด
          <Link className="btn sm" href="/journal">ดูสมุดรายวันทั้งหมด</Link>
        </div>
        <div className="table-wrap">
          {recent.length === 0 ? (
            <div className="empty">ยังไม่มีรายการบัญชี</div>
          ) : (
            <table className="tbl cards">
              <thead>
                <tr>
                  <th>เลขที่ใบสำคัญ</th>
                  <th>วันที่</th>
                  <th>ที่มา</th>
                  <th>คำอธิบาย</th>
                  <th className="num">จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td data-label="เลขที่ใบสำคัญ" className="code card-title">
                      <Link href={`/journal/${r.id}`}>{r.entry_no}</Link>
                    </td>
                    <td data-label="วันที่" className="nowrap">{thaiDate(r.entry_date)}</td>
                    <td data-label="ที่มา"><span className="badge plain">{SOURCE_TH[r.source_type] ?? r.source_type}</span></td>
                    <td data-label="คำอธิบาย">{r.description}</td>
                    <td data-label="จำนวนเงิน" className="num">{baht(r.amount)}</td>
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

