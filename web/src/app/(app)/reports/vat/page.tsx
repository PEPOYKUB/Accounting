import { q } from '@/lib/db'
import { baht, thaiDate, thaiPeriod } from '@/lib/money'
import { listPeriods, workingPeriod } from '@/lib/queries'
import PeriodPicker from '@/components/PeriodPicker'

export const dynamic = 'force-dynamic'

export default async function VatReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const sp = await searchParams
  const periods = await listPeriods()
  const fallback = await workingPeriod()
  const periodId = sp.period ?? fallback?.id ?? periods[0]?.id
  const period = periods.find((p) => p.id === periodId)

  const output = periodId
    ? await q<{
        seq_no: number; tax_invoice_date: string; tax_invoice_no: string
        customer_name: string; customer_tax_id: string | null; customer_branch: string | null
        base_amount: string; vat_amount: string
      }>(
        `SELECT seq_no, tax_invoice_date::text, tax_invoice_no, customer_name,
                customer_tax_id, customer_branch, base_amount::text, vat_amount::text
           FROM acc.vat_output_items WHERE period_id = $1::bigint ORDER BY seq_no`,
        [periodId]
      )
    : []

  const input = periodId
    ? await q<{
        seq_no: number; tax_invoice_date: string; tax_invoice_no: string
        vendor_name: string; vendor_tax_id: string | null; vendor_branch: string | null
        base_amount: string; vat_amount: string; is_claimable: boolean
      }>(
        `SELECT seq_no, tax_invoice_date::text, tax_invoice_no, vendor_name,
                vendor_tax_id, vendor_branch, base_amount::text, vat_amount::text, is_claimable
           FROM acc.vat_input_items WHERE period_id = $1::bigint ORDER BY seq_no`,
        [periodId]
      )
    : []

  const wht = periodId
    ? await q<{
        doc_no: string; payee_name: string; issue_date: string; wht_form: string
        base_amount: string; wht_amount: string; is_remitted: boolean
      }>(
        `SELECT w.doc_no, p.partner_name AS payee_name, w.issue_date::text, w.wht_form::text,
                w.base_amount::text, w.wht_amount::text, w.is_remitted
           FROM acc.wht_certificates w
           JOIN acc.business_partners p ON p.id = w.payee_id
          WHERE w.period_id = $1::bigint ORDER BY w.issue_date, w.doc_no`,
        [periodId]
      )
    : []

  const outVat = output.reduce((a, r) => a + Number(r.vat_amount), 0)
  const inVat = input.filter((r) => r.is_claimable).reduce((a, r) => a + Number(r.vat_amount), 0)
  const net = outVat - inVat

  return (
    <>
      <div className="page-head">
        <div>
          <h1>รายงานภาษี</h1>
          <p>รายงานภาษีขาย-ภาษีซื้อ ตามรูปแบบประกาศอธิบดี และหนังสือรับรองหักภาษี ณ ที่จ่าย</p>
        </div>
        <PeriodPicker periods={periods} selected={periodId ?? ''} />
      </div>

      <div className="grid c4" style={{ marginBottom: 14 }}>
        <div className="card stat">
          <div className="label">ภาษีขาย</div>
          <div className="value">{baht(outVat)}</div>
          <div className="sub">{output.length} รายการ</div>
        </div>
        <div className="card stat">
          <div className="label">ภาษีซื้อ (ใช้สิทธิได้)</div>
          <div className="value">{baht(inVat)}</div>
          <div className="sub">{input.filter((r) => r.is_claimable).length} รายการ</div>
        </div>
        <div className="card stat">
          <div className="label">{net >= 0 ? 'ภาษีที่ต้องชำระ' : 'ภาษีที่ขอคืน/ยกไป'}</div>
          <div className="value" style={{ color: net >= 0 ? 'var(--danger)' : 'var(--ok)' }}>
            {baht(Math.abs(net))}
          </div>
          <div className="sub">ยื่น ภพ.30 ภายในวันที่ 15 ของเดือนถัดไป</div>
        </div>
        <div className="card stat">
          <div className="label">ภาษีหัก ณ ที่จ่ายที่ต้องนำส่ง</div>
          <div className="value">{baht(wht.reduce((a, r) => a + Number(r.wht_amount), 0))}</div>
          <div className="sub">ยื่นภายในวันที่ 7 ของเดือนถัดไป</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">รายงานภาษีขาย — {thaiPeriod(period?.period_name)}</div>
        <div className="table-wrap">
          {output.length === 0 ? (
            <div className="empty">งวดนี้ไม่มีภาษีขาย</div>
          ) : (
            <table className="tbl cards">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>ลำดับ</th>
                  <th>วันที่</th>
                  <th>เลขที่ใบกำกับภาษี</th>
                  <th>ชื่อผู้ซื้อ</th>
                  <th>เลขประจำตัวผู้เสียภาษี</th>
                  <th>สาขา</th>
                  <th className="num">มูลค่าสินค้า/บริการ</th>
                  <th className="num">ภาษีมูลค่าเพิ่ม</th>
                </tr>
              </thead>
              <tbody>
                {output.map((r) => (
                  <tr key={r.seq_no}>
                    <td data-label="ลำดับ" className="num">{r.seq_no}</td>
                    <td data-label="วันที่" className="nowrap">{thaiDate(r.tax_invoice_date)}</td>
                    <td data-label="เลขที่ใบกำกับภาษี" className="code">{r.tax_invoice_no}</td>
                    <td data-label="ชื่อผู้ซื้อ">{r.customer_name}</td>
                    <td data-label="เลขประจำตัวผู้เสียภาษี" className="code">{r.customer_tax_id ?? '—'}</td>
                    <td data-label="สาขา" className="code">{r.customer_branch ?? '—'}</td>
                    <td data-label="มูลค่าสินค้า/บริการ" className="num">{baht(r.base_amount)}</td>
                    <td data-label="ภาษีมูลค่าเพิ่ม" className="num">{baht(r.vat_amount)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={6}>รวม</td>
                  <td className="num">{baht(output.reduce((a, r) => a + Number(r.base_amount), 0))}</td>
                  <td className="num">{baht(outVat)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">รายงานภาษีซื้อ — {thaiPeriod(period?.period_name)}</div>
        <div className="table-wrap">
          {input.length === 0 ? (
            <div className="empty">งวดนี้ไม่มีภาษีซื้อ</div>
          ) : (
            <table className="tbl cards">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>ลำดับ</th>
                  <th>วันที่</th>
                  <th>เลขที่ใบกำกับภาษี</th>
                  <th>ชื่อผู้ขาย</th>
                  <th>เลขประจำตัวผู้เสียภาษี</th>
                  <th>สาขา</th>
                  <th className="num">มูลค่าสินค้า/บริการ</th>
                  <th className="num">ภาษีมูลค่าเพิ่ม</th>
                </tr>
              </thead>
              <tbody>
                {input.map((r) => (
                  <tr key={r.seq_no}>
                    <td data-label="ลำดับ" className="num">{r.seq_no}</td>
                    <td data-label="วันที่" className="nowrap">{thaiDate(r.tax_invoice_date)}</td>
                    <td data-label="เลขที่ใบกำกับภาษี" className="code">{r.tax_invoice_no}</td>
                    <td data-label="ชื่อผู้ขาย">
                      {r.vendor_name}
                      {!r.is_claimable && <span className="badge danger" style={{ marginLeft: 6 }}>ต้องห้าม</span>}
                    </td>
                    <td data-label="เลขประจำตัวผู้เสียภาษี" className="code">{r.vendor_tax_id ?? '—'}</td>
                    <td data-label="สาขา" className="code">{r.vendor_branch ?? '—'}</td>
                    <td data-label="มูลค่าสินค้า/บริการ" className="num">{baht(r.base_amount)}</td>
                    <td data-label="ภาษีมูลค่าเพิ่ม" className="num">{baht(r.vat_amount)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={6}>รวมที่ใช้สิทธิได้</td>
                  <td className="num">
                    {baht(input.filter((r) => r.is_claimable).reduce((a, r) => a + Number(r.base_amount), 0))}
                  </td>
                  <td className="num">{baht(inVat)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">หนังสือรับรองหักภาษี ณ ที่จ่ายที่ออกในงวด</div>
        <div className="table-wrap">
          {wht.length === 0 ? (
            <div className="empty">งวดนี้ไม่มีการหักภาษี ณ ที่จ่าย</div>
          ) : (
            <table className="tbl cards">
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th>วันที่</th>
                  <th>ผู้ถูกหัก</th>
                  <th>แบบยื่น</th>
                  <th className="num">ฐานภาษี</th>
                  <th className="num">ภาษีที่หัก</th>
                  <th>นำส่งแล้ว</th>
                </tr>
              </thead>
              <tbody>
                {wht.map((r) => (
                  <tr key={r.doc_no}>
                    <td data-label="เลขที่" className="code">{r.doc_no}</td>
                    <td data-label="วันที่" className="nowrap">{thaiDate(r.issue_date)}</td>
                    <td data-label="ผู้ถูกหัก">{r.payee_name}</td>
                    <td data-label="แบบยื่น"><span className="badge plain">{r.wht_form}</span></td>
                    <td data-label="ฐานภาษี" className="num">{baht(r.base_amount)}</td>
                    <td data-label="ภาษีที่หัก" className="num">{baht(r.wht_amount)}</td>
                    <td data-label="นำส่งแล้ว">
                      <span className={`badge ${r.is_remitted ? 'ok' : 'warn'}`}>
                        {r.is_remitted ? 'นำส่งแล้ว' : 'ยังไม่นำส่ง'}
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
