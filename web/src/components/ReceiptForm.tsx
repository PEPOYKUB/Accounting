'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createReceipt } from '@/lib/posting'
import { toSatang, fromSatang, pct, proportion, baht, thaiDate, today } from '@/lib/money'

export type OpenInvoice = {
  id: string
  doc_no: string
  customer_id: string
  issue_date: string
  due_date: string
  total_amount: string
  vat_amount: string
  balance_due: string
  expected_wht_rate: string | null
}

export default function ReceiptForm({
  customers,
  openInvoices,
  banks,
}: {
  customers: { id: string; partner_code: string; partner_name: string; default_wht_rate: string | null }[]
  openInvoices: OpenInvoice[]
  banks: { id: string; label: string }[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '')
  const [receiptDate, setReceiptDate] = useState(today())
  const [bankId, setBankId] = useState(banks[0]?.id ?? '')
  const [fee, setFee] = useState('')
  const [picked, setPicked] = useState<Record<string, { amount: string; wht: string }>>({})

  const invoices = useMemo(
    () => openInvoices.filter((i) => i.customer_id === customerId),
    [openInvoices, customerId]
  )

  const totals = useMemo(() => {
    let gross = 0, wht = 0, vatMove = 0
    for (const inv of invoices) {
      const p = picked[inv.id]
      if (!p) continue
      const applied = toSatang(p.amount)
      if (applied <= 0) continue
      const vatPart = proportion(toSatang(inv.vat_amount), toSatang(inv.total_amount), applied)
      gross += applied
      vatMove += vatPart
      wht += pct(applied - vatPart, p.wht || '0')
    }
    const feeS = toSatang(fee)
    return { gross, wht, vatMove, fee: feeS, net: gross - wht - feeS }
  }, [invoices, picked, fee])

  function toggle(inv: OpenInvoice, on: boolean) {
    setPicked((prev) => {
      const next = { ...prev }
      if (on) next[inv.id] = { amount: (toSatang(inv.balance_due) / 100).toFixed(2), wht: inv.expected_wht_rate ?? '3' }
      else delete next[inv.id]
      return next
    })
  }

  function submit() {
    setError(null)
    const allocations = Object.entries(picked)
      .filter(([, v]) => toSatang(v.amount) > 0)
      .map(([invoice_id, v]) => ({ invoice_id, applied_amount: v.amount, wht_rate: v.wht }))

    if (allocations.length === 0) { setError('ต้องเลือกใบแจ้งหนี้ที่จะรับชำระอย่างน้อย 1 ใบ'); return }
    if (!bankId) { setError('ต้องเลือกบัญชีธนาคารที่รับเงิน'); return }

    const fd = new FormData()
    fd.set('customer_id', customerId)
    fd.set('receipt_date', receiptDate)
    fd.set('bank_account_id', bankId)
    fd.set('fee_amount', fee || '0')
    fd.set('allocations', JSON.stringify(allocations))

    start(async () => {
      const res = await createReceipt(fd)
      if (res.ok) router.push(`/receipts?created=${encodeURIComponent(res.docNo)}`)
      else setError(res.error)
    })
  }

  return (
    <>
      {error && <div className="alert err"><div>{error}</div></div>}

      <div className="alert info">
        <div>
          จุดนี้คือจุดที่ <strong>ภาษีขายถึงกำหนดนำส่ง</strong> — ระบบจะโอนพักภาษีขายเข้าภาษีขายตามสัดส่วนที่รับจริง
          ออกเลขใบกำกับภาษีให้อัตโนมัติ และบันทึกภาษีที่ลูกค้าหักไว้เป็นสินทรัพย์ (1160) เพื่อใช้เครดิตตอนยื่น ภงด.50
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label>ลูกค้า</label>
              <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setPicked({}) }}>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.partner_code} — {c.partner_name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>วันที่รับเงิน</label>
              <input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
            </div>
            <div className="field">
              <label>บัญชีที่รับเงิน</label>
              <select value={bankId} onChange={(e) => setBankId(e.target.value)}>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>ค่าธรรมเนียมโอน</label>
              <input type="text" inputMode="decimal" className="num" value={fee}
                onChange={(e) => setFee(e.target.value)} placeholder="0.00" />
              <div className="hint">ถ้าฝ่ายเรารับภาระ จะลงเป็นค่าธรรมเนียมธนาคาร (5190)</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">เลือกใบแจ้งหนี้ที่รับชำระ</div>
        <div className="table-wrap">
          {invoices.length === 0 ? (
            <div className="empty">ลูกค้ารายนี้ไม่มีใบแจ้งหนี้ค้างชำระ</div>
          ) : (
            <table className="tbl form-cards">
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>เลขที่</th>
                  <th>วันที่</th>
                  <th>ครบกำหนด</th>
                  <th className="num">ยอดค้าง</th>
                  <th className="num" style={{ width: 140 }}>รับชำระ</th>
                  <th style={{ width: 90 }}>หัก ณ ที่จ่าย %</th>
                  <th className="num">ภาษีถูกหัก</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const p = picked[inv.id]
                  const applied = toSatang(p?.amount ?? '0')
                  const vatPart = proportion(toSatang(inv.vat_amount), toSatang(inv.total_amount), applied)
                  const whtS = pct(applied - vatPart, p?.wht ?? '0')
                  return (
                    <tr key={inv.id}>
                      <td data-label="เลือกใบนี้" className="line-check">
                        <input type="checkbox" checked={!!p} style={{ width: 'auto' }}
                          onChange={(e) => toggle(inv, e.target.checked)} />
                      </td>
                      <td data-label="เลขที่" className="code card-title">{inv.doc_no}</td>
                      <td data-label="วันที่" className="nowrap computed">{thaiDate(inv.issue_date)}</td>
                      <td data-label="ครบกำหนด" className="nowrap computed">{thaiDate(inv.due_date)}</td>
                      <td data-label="ยอดค้าง" className="num computed">{baht(inv.balance_due)}</td>
                      <td data-label="รับชำระ">
                        <input type="text" inputMode="decimal" className="num" disabled={!p}
                          value={p?.amount ?? ''}
                          onChange={(e) => setPicked((prev) => ({ ...prev, [inv.id]: { ...prev[inv.id], amount: e.target.value } }))} />
                      </td>
                      <td data-label="หัก ณ ที่จ่าย %">
                        <input type="text" inputMode="decimal" className="num" disabled={!p}
                          value={p?.wht ?? ''}
                          onChange={(e) => setPicked((prev) => ({ ...prev, [inv.id]: { ...prev[inv.id], wht: e.target.value } }))} />
                      </td>
                      <td data-label="ภาษีถูกหัก" className="num muted computed">{p ? baht(fromSatang(whtS)) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="totals-box" style={{ maxWidth: 360, marginLeft: 'auto' }}>
            <table className="tbl form-cards">
              <tbody>
                <tr><td>ยอดตัดลูกหนี้</td><td className="num">{baht(fromSatang(totals.gross))}</td></tr>
                <tr><td>หัก ภาษีถูกหัก ณ ที่จ่าย</td><td className="num">({baht(fromSatang(totals.wht))})</td></tr>
                {totals.fee > 0 && <tr><td>หัก ค่าธรรมเนียม</td><td className="num">({baht(fromSatang(totals.fee))})</td></tr>}
                <tr className="total"><td>เงินเข้าบัญชีจริง</td><td className="num">{baht(fromSatang(totals.net))}</td></tr>
                <tr><td className="muted">โอนพักภาษีขายเข้าภาษีขาย</td>
                  <td className="num muted">{baht(fromSatang(totals.vatMove))}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="toolbar form-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => router.back()} disabled={pending}>ยกเลิก</button>
            <button type="button" className="btn primary" onClick={submit} disabled={pending}>
              {pending ? 'กำลังบันทึกและลงบัญชี…' : 'บันทึกรับเงินและออกใบกำกับภาษี'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
