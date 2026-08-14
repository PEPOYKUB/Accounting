'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createBill } from '@/lib/posting'
import { toSatang, fromSatang, pct, baht, today, addDays } from '@/lib/money'
import type { Account, Partner } from '@/lib/queries'
import { WHT_FORM_TH } from '@/lib/labels'

type Line = {
  description: string
  line_amount: string
  expense_account_code: string
  vat_rate: string
  wht_rate: string
  cost_center_id: string
}

const blank = (acct: string, wht: string): Line => ({
  description: '',
  line_amount: '',
  expense_account_code: acct,
  vat_rate: '7',
  wht_rate: wht,
  cost_center_id: '',
})

export default function BillForm({
  vendors,
  expenseAccounts,
  costCenters,
}: {
  vendors: Partner[]
  expenseAccounts: Account[]
  costCenters: { id: string; code: string; name: string }[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const defaultAccount = expenseAccounts[0]?.account_code ?? ''
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? '')
  const [billDate, setBillDate] = useState(today())
  const [dueDate, setDueDate] = useState(addDays(today(), 30))
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState('')
  const [vatTiming, setVatTiming] = useState<'ON_PAYMENT' | 'ON_INVOICE'>('ON_PAYMENT')
  const [whtForm, setWhtForm] = useState(vendors[0]?.default_wht_form ?? 'PND53')
  const [lines, setLines] = useState<Line[]>([blank(defaultAccount, vendors[0]?.default_wht_rate ?? '3')])

  const totals = useMemo(() => {
    let sub = 0, vat = 0, wht = 0
    for (const l of lines) {
      const amt = toSatang(l.line_amount)
      sub += amt
      vat += pct(amt, l.vat_rate || '0')
      wht += pct(amt, l.wht_rate || '0')
    }
    return { sub, vat, wht, total: sub + vat, cashOut: sub + vat - wht }
  }, [lines])

  function update(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  function onVendor(id: string) {
    setVendorId(id)
    const v = vendors.find((x) => x.id === id)
    if (v) {
      setWhtForm(v.default_wht_form ?? 'PND53')
      setDueDate(addDays(billDate, v.credit_days ?? 30))
      setLines((prev) => prev.map((l) => ({ ...l, wht_rate: v.default_wht_rate ?? l.wht_rate })))
    }
  }

  function submit() {
    setError(null)
    const clean = lines.filter((l) => toSatang(l.line_amount) > 0 && l.description.trim())
    if (clean.length === 0) {
      setError('ต้องกรอกรายการอย่างน้อย 1 บรรทัด พร้อมคำอธิบายและจำนวนเงิน')
      return
    }

    const fd = new FormData()
    fd.set('vendor_id', vendorId)
    fd.set('bill_date', billDate)
    fd.set('due_date', dueDate)
    fd.set('vendor_invoice_no', vendorInvoiceNo)
    fd.set('vat_timing', vatTiming)
    fd.set('wht_form', whtForm)
    fd.set('lines', JSON.stringify(clean))

    start(async () => {
      const res = await createBill(fd)
      if (res.ok) router.push(`/bills?created=${encodeURIComponent(res.docNo)}`)
      else setError(res.error)
    })
  }

  return (
    <>
      {error && <div className="alert err"><div>{error}</div></div>}

      <div className="alert info">
        <div>
          <strong>เจ้าหนี้จะถูกบันทึกเป็นยอดเต็มรวมภาษีมูลค่าเพิ่ม</strong> ยังไม่หักภาษี ณ ที่จ่ายในขั้นนี้
          เพราะภาษีหัก ณ ที่จ่ายเกิดขึ้นเมื่อ<u>จ่ายเงิน</u>จริง — ระบบจะหักให้ตอนบันทึกใบสำคัญจ่าย
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label>ผู้ขาย</label>
              <select value={vendorId} onChange={(e) => onVendor(e.target.value)}>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.partner_code} — {v.partner_name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>เลขที่เอกสารผู้ขาย</label>
              <input type="text" value={vendorInvoiceNo}
                onChange={(e) => setVendorInvoiceNo(e.target.value)} placeholder="เลขที่ใบแจ้งหนี้/ใบกำกับภาษี" />
            </div>
            <div className="field">
              <label>วันที่ตั้งหนี้</label>
              <input type="date" value={billDate}
                onChange={(e) => { setBillDate(e.target.value); setDueDate(addDays(e.target.value, 30)) }} />
            </div>
            <div className="field">
              <label>ครบกำหนดจ่าย</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>จังหวะใช้สิทธิภาษีซื้อ</label>
              <select value={vatTiming} onChange={(e) => setVatTiming(e.target.value as 'ON_PAYMENT' | 'ON_INVOICE')}>
                <option value="ON_PAYMENT">ค่าบริการ — ได้ใบกำกับภาษีตอนจ่ายเงิน (พักภาษีซื้อ)</option>
                <option value="ON_INVOICE">ค่าสินค้า — ได้ใบกำกับภาษีพร้อมของ (ใช้สิทธิได้ทันที)</option>
              </select>
              <div className="hint">
                {vatTiming === 'ON_PAYMENT'
                  ? 'ลงบัญชี 1151 พักภาษีซื้อ แล้วโอนเข้า 1150 ตอนจ่ายเงิน'
                  : 'ลงบัญชี 1150 ภาษีซื้อ และเข้ารายงานภาษีซื้อทันที'}
              </div>
            </div>
            <div className="field">
              <label>แบบยื่นภาษีหัก ณ ที่จ่าย</label>
              <select value={whtForm} onChange={(e) => setWhtForm(e.target.value)}>
                {Object.entries(WHT_FORM_TH).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          รายการ
          <button type="button" className="btn sm"
            onClick={() => setLines((p) => [...p, blank(defaultAccount, '3')])}>+ เพิ่มบรรทัด</button>
        </div>
        <div className="table-wrap">
          <table className="tbl form-cards">
            <thead>
              <tr>
                <th style={{ minWidth: 210 }}>คำอธิบาย</th>
                <th style={{ minWidth: 210 }}>บัญชีค่าใช้จ่าย/สินทรัพย์</th>
                {costCenters.length > 0 && <th style={{ width: 140 }}>ศูนย์ต้นทุน</th>}
                <th style={{ width: 130 }}>จำนวนเงิน</th>
                <th style={{ width: 75 }}>VAT %</th>
                <th style={{ width: 75 }}>หัก ณ ที่จ่าย %</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td data-label="คำอธิบาย"><input type="text" value={l.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                    placeholder="เช่น ค่าจ้างผู้รับเหมาช่วง" /></td>
                  <td data-label="บัญชีค่าใช้จ่าย/สินทรัพย์">
                    <select value={l.expense_account_code}
                      onChange={(e) => update(i, { expense_account_code: e.target.value })}>
                      {expenseAccounts.map((a) => (
                        <option key={a.account_code} value={a.account_code}>
                          {a.account_code} {a.account_name}
                        </option>
                      ))}
                    </select>
                  </td>
                  {costCenters.length > 0 && (
                    <td data-label="ศูนย์ต้นทุน">
                      <select value={l.cost_center_id}
                        onChange={(e) => update(i, { cost_center_id: e.target.value })}>
                        <option value="">—</option>
                        {costCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                  )}
                  <td data-label="จำนวนเงิน"><input type="text" inputMode="decimal" className="num" value={l.line_amount}
                    onChange={(e) => update(i, { line_amount: e.target.value })} /></td>
                  <td data-label="VAT %"><input type="text" inputMode="decimal" className="num" value={l.vat_rate}
                    onChange={(e) => update(i, { vat_rate: e.target.value })} /></td>
                  <td data-label="หัก ณ ที่จ่าย %"><input type="text" inputMode="decimal" className="num" value={l.wht_rate}
                    onChange={(e) => update(i, { wht_rate: e.target.value })} /></td>
                  <td className="line-remove">
                    {lines.length > 1 && (
                      <button type="button" className="btn sm danger"
                        onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="totals-box" style={{ maxWidth: 340, marginLeft: 'auto' }}>
            <table className="tbl form-cards">
              <tbody>
                <tr><td>ยอดก่อนภาษี</td><td className="num">{baht(fromSatang(totals.sub))}</td></tr>
                <tr><td>ภาษีมูลค่าเพิ่ม</td><td className="num">{baht(fromSatang(totals.vat))}</td></tr>
                <tr className="total"><td>ยอดตั้งเจ้าหนี้</td><td className="num">{baht(fromSatang(totals.total))}</td></tr>
                <tr><td className="muted">หัก ณ ที่จ่าย (ตอนจ่ายเงิน)</td>
                  <td className="num muted">({baht(fromSatang(totals.wht))})</td></tr>
                <tr><td className="muted">เงินที่ต้องจ่ายจริง</td>
                  <td className="num muted">{baht(fromSatang(totals.cashOut))}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="toolbar form-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => router.back()} disabled={pending}>ยกเลิก</button>
            <button type="button" className="btn primary" onClick={submit} disabled={pending}>
              {pending ? 'กำลังบันทึกและลงบัญชี…' : 'บันทึกและลงบัญชี'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
