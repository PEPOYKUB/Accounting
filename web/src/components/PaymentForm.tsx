'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createPayment } from '@/lib/posting'
import { toSatang, fromSatang, pct, proportion, baht, thaiDate, today } from '@/lib/money'

export type OpenBill = {
  id: string
  doc_no: string
  vendor_id: string
  bill_date: string
  due_date: string
  total_amount: string
  vat_amount: string
  balance_due: string
  wht_rate: string | null
  wht_form: string | null
  vat_timing: string
}

export default function PaymentForm({
  vendors,
  openBills,
  banks,
}: {
  vendors: { id: string; partner_code: string; partner_name: string }[]
  openBills: OpenBill[]
  banks: { id: string; label: string }[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? '')
  const [paymentDate, setPaymentDate] = useState(today())
  const [bankId, setBankId] = useState(banks[0]?.id ?? '')
  const [picked, setPicked] = useState<Record<string, string>>({})

  const bills = useMemo(() => openBills.filter((b) => b.vendor_id === vendorId), [openBills, vendorId])

  const totals = useMemo(() => {
    let gross = 0, wht = 0, vatMove = 0
    for (const b of bills) {
      const amount = picked[b.id]
      if (!amount) continue
      const applied = toSatang(amount)
      if (applied <= 0) continue
      const vatPart = proportion(toSatang(b.vat_amount), toSatang(b.total_amount), applied)
      gross += applied
      wht += pct(applied - vatPart, b.wht_rate ?? '0')
      if (b.vat_timing === 'ON_PAYMENT') vatMove += vatPart
    }
    return { gross, wht, vatMove, net: gross - wht }
  }, [bills, picked])

  function toggle(b: OpenBill, on: boolean) {
    setPicked((prev) => {
      const next = { ...prev }
      if (on) next[b.id] = (toSatang(b.balance_due) / 100).toFixed(2)
      else delete next[b.id]
      return next
    })
  }

  function submit() {
    setError(null)
    const allocations = Object.entries(picked)
      .filter(([, v]) => toSatang(v) > 0)
      .map(([bill_id, applied_amount]) => ({ bill_id, applied_amount }))

    if (allocations.length === 0) { setError('ต้องเลือกใบตั้งหนี้ที่จะจ่ายอย่างน้อย 1 ใบ'); return }
    if (!bankId) { setError('ต้องเลือกบัญชีธนาคารที่จ่ายเงิน'); return }

    const fd = new FormData()
    fd.set('vendor_id', vendorId)
    fd.set('payment_date', paymentDate)
    fd.set('bank_account_id', bankId)
    fd.set('allocations', JSON.stringify(allocations))

    start(async () => {
      const res = await createPayment(fd)
      if (res.ok) router.push(`/payments?created=${encodeURIComponent(res.docNo)}`)
      else setError(res.error)
    })
  }

  return (
    <>
      {error && <div className="alert err"><div>{error}</div></div>}

      <div className="alert info">
        <div>
          ระบบจะหักภาษี ณ ที่จ่ายจาก<strong>ฐานก่อนภาษีมูลค่าเพิ่ม</strong>ตามอัตราที่ตั้งไว้ในใบตั้งหนี้
          ออกหนังสือรับรองหัก ณ ที่จ่ายให้อัตโนมัติ และโอนพักภาษีซื้อเข้าภาษีซื้อสำหรับใบที่รอใบกำกับภาษี
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label>ผู้ขาย</label>
              <select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setPicked({}) }}>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.partner_code} — {v.partner_name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>วันที่จ่ายเงิน</label>
              <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
            <div className="field">
              <label>บัญชีที่จ่ายเงิน</label>
              <select value={bankId} onChange={(e) => setBankId(e.target.value)}>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">เลือกใบตั้งหนี้ที่จะจ่าย</div>
        <div className="table-wrap">
          {bills.length === 0 ? (
            <div className="empty">ผู้ขายรายนี้ไม่มีใบตั้งหนี้ค้างจ่าย</div>
          ) : (
            <table className="tbl form-cards">
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>เลขที่</th>
                  <th>วันที่</th>
                  <th>ครบกำหนด</th>
                  <th className="num">ยอดค้าง</th>
                  <th className="num" style={{ width: 140 }}>จ่าย</th>
                  <th className="num">หัก ณ ที่จ่าย</th>
                  <th className="num">จ่ายสุทธิ</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => {
                  const amount = picked[b.id]
                  const applied = toSatang(amount ?? '0')
                  const vatPart = proportion(toSatang(b.vat_amount), toSatang(b.total_amount), applied)
                  const whtS = pct(applied - vatPart, b.wht_rate ?? '0')
                  return (
                    <tr key={b.id}>
                      <td data-label="เลือกใบนี้" className="line-check">
                        <input type="checkbox" checked={amount !== undefined} style={{ width: 'auto' }}
                          onChange={(e) => toggle(b, e.target.checked)} />
                      </td>
                      <td data-label="เลขที่" className="code card-title">{b.doc_no}</td>
                      <td data-label="วันที่" className="nowrap computed">{thaiDate(b.bill_date)}</td>
                      <td data-label="ครบกำหนด" className="nowrap computed">{thaiDate(b.due_date)}</td>
                      <td data-label="ยอดค้าง" className="num computed">{baht(b.balance_due)}</td>
                      <td data-label="จำนวนที่จ่าย">
                        <input type="text" inputMode="decimal" className="num" disabled={amount === undefined}
                          value={amount ?? ''}
                          onChange={(e) => setPicked((prev) => ({ ...prev, [b.id]: e.target.value }))} />
                      </td>
                      <td data-label="หัก ณ ที่จ่าย" className="num muted computed">
                        {amount !== undefined ? `${baht(fromSatang(whtS))} (${b.wht_rate ?? 0}%)` : '—'}
                      </td>
                      <td data-label="จ่ายสุทธิ" className="num computed">{amount !== undefined ? baht(fromSatang(applied - whtS)) : '—'}</td>
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
                <tr><td>ยอดตัดเจ้าหนี้</td><td className="num">{baht(fromSatang(totals.gross))}</td></tr>
                <tr><td>หัก ภาษี ณ ที่จ่ายนำส่ง</td><td className="num">({baht(fromSatang(totals.wht))})</td></tr>
                <tr className="total"><td>เงินจ่ายจริง</td><td className="num">{baht(fromSatang(totals.net))}</td></tr>
                {totals.vatMove > 0 && (
                  <tr><td className="muted">โอนพักภาษีซื้อเข้าภาษีซื้อ</td>
                    <td className="num muted">{baht(fromSatang(totals.vatMove))}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="toolbar form-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => router.back()} disabled={pending}>ยกเลิก</button>
            <button type="button" className="btn primary" onClick={submit} disabled={pending}>
              {pending ? 'กำลังบันทึกและลงบัญชี…' : 'บันทึกจ่ายเงินและออกหนังสือรับรอง'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
