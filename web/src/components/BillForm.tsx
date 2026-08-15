'use client'

import { useState, useTransition, useMemo, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createBill } from '@/lib/posting'
import { toSatang, fromSatang, pct, baht, today, addDays } from '@/lib/money'
import type { Account, Partner } from '@/lib/queries'
import { WHT_FORM_TH } from '@/lib/labels'
import { WHT_RATES, normRate } from '@/lib/rates'
import Combo, { type ComboOption } from '@/components/Combo'
import VatPicker from '@/components/VatPicker'
import AmountInput from '@/components/AmountInput'
import FormShortcuts from '@/components/FormShortcuts'

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

  /*
    ตั้งใจไม่เลือกบัญชีไว้ล่วงหน้า
    รายการที่ส่งเข้ามาเรียงตามรหัสบัญชี ตัวแรกจึงเป็นสินทรัพย์อย่างเงินสด
    ถ้าตั้งเป็นค่าเริ่มต้นไว้ คนที่คีย์เร็วอาจบันทึกค่าใช้จ่ายลงบัญชีเงินสดโดยไม่รู้ตัว
    ตอนนี้ช่องเลือกพิมพ์ค้นหาได้แล้ว การบังคับให้เลือกเองจึงไม่ได้ช้าลง แต่ปลอดภัยขึ้นมาก
  */
  const defaultAccount = ''
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? '')
  const [billDate, setBillDate] = useState(today())
  const [dueDate, setDueDate] = useState(addDays(today(), 30))
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState('')
  const [vatTiming, setVatTiming] = useState<'ON_PAYMENT' | 'ON_INVOICE'>('ON_PAYMENT')
  const [whtForm, setWhtForm] = useState(vendors[0]?.default_wht_form ?? 'PND53')
  const [lines, setLines] = useState<Line[]>([blank(defaultAccount, normRate(vendors[0]?.default_wht_rate))])

  const lineRefs = useRef<(HTMLInputElement | null)[]>([])
  const focusLine = useRef<number | null>(null)

  useEffect(() => {
    const i = focusLine.current
    if (i == null) return
    focusLine.current = null
    lineRefs.current[i]?.focus()
  }, [lines.length])

  const vendorOptions = useMemo<ComboOption[]>(
    () => vendors.map((v) => ({
      value: v.id, label: v.partner_name, hint: v.partner_code, keywords: v.partner_code,
    })),
    [vendors]
  )

  // ใบตั้งหนี้ส่วนใหญ่เป็นค่าใช้จ่าย จึงยกกลุ่มค่าใช้จ่ายขึ้นก่อนสินทรัพย์
  const accountOptions = useMemo<ComboOption[]>(
    () => [...expenseAccounts]
      .sort((a, b) => {
        const rank = (t: string) => (t === 'EXPENSE' ? 0 : 1)
        return rank(a.account_type) - rank(b.account_type)
          || a.account_code.localeCompare(b.account_code)
      })
      .map((a) => ({
        value: a.account_code, label: a.account_name, hint: a.account_code, keywords: a.account_code,
      })),
    [expenseAccounts]
  )

  const costCenterOptions = useMemo<ComboOption[]>(
    () => costCenters.map((c) => ({ value: c.id, label: c.name, hint: c.code, keywords: c.code })),
    [costCenters]
  )

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

  const filled = lines.filter((l) => toSatang(l.line_amount) > 0 && l.description.trim()).length

  function update(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  const addLine = useCallback((copyFrom?: number) => {
    setLines((prev) => {
      const last = prev[prev.length - 1]
      const next: Line = copyFrom != null
        ? { ...prev[copyFrom] }
        : {
            ...blank(last?.expense_account_code || defaultAccount, normRate(last?.wht_rate)),
            vat_rate: last?.vat_rate ?? '7',
            cost_center_id: last?.cost_center_id ?? '',
          }
      focusLine.current = prev.length
      return [...prev, next]
    })
  }, [defaultAccount])

  function onVendor(id: string) {
    setVendorId(id)
    const v = vendors.find((x) => x.id === id)
    if (v) {
      setWhtForm(v.default_wht_form ?? 'PND53')
      setDueDate(addDays(billDate, v.credit_days ?? 30))
      setLines((prev) => prev.map((l) => ({ ...l, wht_rate: normRate(v.default_wht_rate, l.wht_rate) })))
    }
  }

  const submit = useCallback(() => {
    setError(null)
    const clean = lines.filter((l) => toSatang(l.line_amount) > 0 && l.description.trim())
    if (clean.length === 0) {
      setError('ต้องกรอกรายการอย่างน้อย 1 บรรทัด พร้อมคำอธิบายและจำนวนเงิน')
      return
    }
    // จับให้ได้ตั้งแต่ก่อนส่ง จะได้บอกว่าบรรทัดไหนขาด แทนที่จะให้เซิร์ฟเวอร์ตอบข้อความกว้าง ๆ
    const missing = clean.findIndex((l) => !l.expense_account_code)
    if (missing >= 0) {
      setError(`บรรทัดที่ ${missing + 1} ยังไม่ได้เลือกบัญชีค่าใช้จ่าย/สินทรัพย์`)
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
  }, [lines, vendorId, billDate, dueDate, vendorInvoiceNo, vatTiming, whtForm, router])

  const vendor = vendors.find((v) => v.id === vendorId)

  return (
    <>
      <FormShortcuts onSave={submit} onAddLine={() => addLine()} disabled={pending} />

      {error && <div className="alert err"><div>{error}</div></div>}

      <details className="explain">
        <summary>ใบตั้งหนี้นี้จะลงบัญชีอย่างไร</summary>
        <div className="explain-body">
          <strong>เจ้าหนี้จะถูกบันทึกเป็นยอดเต็มรวมภาษีมูลค่าเพิ่ม</strong> ยังไม่หักภาษี ณ ที่จ่ายในขั้นนี้
          เพราะภาษีหัก ณ ที่จ่ายเกิดขึ้นเมื่อ<u>จ่ายเงิน</u>จริง ระบบจะหักให้ตอนบันทึกใบสำคัญจ่าย
          <br />
          อัตราหัก ณ ที่จ่ายที่กรอกไว้ในแต่ละบรรทัดจึงเป็นเพียงตัวตั้งไว้ล่วงหน้า
          ใช้คำนวณว่าต้องเตรียมเงินจ่ายจริงเท่าไร
        </div>
      </details>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label htmlFor="bill-vendor">ผู้ขาย</label>
              <Combo
                id="bill-vendor"
                options={vendorOptions}
                value={vendorId}
                onChange={onVendor}
                placeholder="พิมพ์ชื่อหรือรหัสผู้ขาย"
                autoFocus
              />
              {vendor && (
                <div className="hint">
                  เครดิต {vendor.credit_days ?? 30} วัน
                  {vendor.tax_id ? ` · เลขผู้เสียภาษี ${vendor.tax_id}` : ''}
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="bill-ref">เลขที่เอกสารผู้ขาย</label>
              <input id="bill-ref" type="text" value={vendorInvoiceNo}
                onChange={(e) => setVendorInvoiceNo(e.target.value)}
                placeholder="เลขที่ใบแจ้งหนี้/ใบกำกับภาษี" />
            </div>
            <div className="field">
              <label htmlFor="bill-date">วันที่ตั้งหนี้</label>
              <input id="bill-date" type="date" value={billDate}
                onChange={(e) => {
                  setBillDate(e.target.value)
                  setDueDate(addDays(e.target.value, vendor?.credit_days ?? 30))
                }} />
            </div>
            <div className="field">
              <label htmlFor="bill-due">ครบกำหนดจ่าย</label>
              <input id="bill-due" type="date" value={dueDate}
                onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="bill-vat-timing">จังหวะใช้สิทธิภาษีซื้อ</label>
              <select id="bill-vat-timing" value={vatTiming}
                onChange={(e) => setVatTiming(e.target.value as 'ON_PAYMENT' | 'ON_INVOICE')}>
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
              <label htmlFor="bill-wht-form">แบบยื่นภาษีหัก ณ ที่จ่าย</label>
              <select id="bill-wht-form" value={whtForm} onChange={(e) => setWhtForm(e.target.value)}>
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
          <button type="button" className="btn sm" onClick={() => addLine()}>+ เพิ่มบรรทัด</button>
        </div>
        <div className="table-wrap">
          <table className="tbl form-cards">
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>คำอธิบาย</th>
                <th style={{ minWidth: 200 }}>บัญชีค่าใช้จ่าย/สินทรัพย์</th>
                {costCenters.length > 0 && <th style={{ width: 140 }}>ศูนย์ต้นทุน</th>}
                <th style={{ width: 130 }}>จำนวนเงิน</th>
                <th style={{ width: 150 }}>ภาษีมูลค่าเพิ่ม</th>
                <th style={{ minWidth: 165 }}>หัก ณ ที่จ่าย</th>
                <th style={{ width: 66 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const isLast = i === lines.length - 1
                return (
                  <tr key={i}>
                    <td data-label="คำอธิบาย">
                      <input type="text"
                        ref={(el) => { lineRefs.current[i] = el }}
                        value={l.description}
                        onChange={(e) => update(i, { description: e.target.value })}
                        placeholder="เช่น ค่าจ้างผู้รับเหมาช่วง" />
                    </td>
                    <td data-label="บัญชีค่าใช้จ่าย/สินทรัพย์">
                      <Combo
                        options={accountOptions}
                        value={l.expense_account_code}
                        onChange={(v) => update(i, { expense_account_code: v })}
                        placeholder="พิมพ์รหัสหรือชื่อบัญชี"
                      />
                    </td>
                    {costCenters.length > 0 && (
                      <td data-label="ศูนย์ต้นทุน">
                        <Combo
                          options={costCenterOptions}
                          value={l.cost_center_id}
                          onChange={(v) => update(i, { cost_center_id: v })}
                          allowEmpty
                          placeholder="ไม่ระบุ"
                        />
                      </td>
                    )}
                    <td data-label="จำนวนเงิน">
                      <AmountInput
                        value={l.line_amount}
                        onChange={(v) => update(i, { line_amount: v })}
                        onEnter={isLast ? () => addLine() : undefined}
                      />
                    </td>
                    <td data-label="ภาษีมูลค่าเพิ่ม">
                      <VatPicker value={l.vat_rate} onChange={(v) => update(i, { vat_rate: v })} />
                    </td>
                    <td data-label="หัก ณ ที่จ่าย">
                      <Combo
                        options={WHT_RATES}
                        value={l.wht_rate}
                        onChange={(v) => update(i, { wht_rate: v })}
                        placeholder="เลือกอัตรา"
                      />
                    </td>
                    <td className="line-remove">
                      <button type="button" className="btn sm" title="คัดลอกบรรทัดนี้"
                        onClick={() => addLine(i)}>⧉</button>
                      {lines.length > 1 && (
                        <button type="button" className="btn sm danger" title="ลบบรรทัดนี้"
                          onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}>✕</button>
                      )}
                    </td>
                  </tr>
                )
              })}
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
        </div>
      </div>

      <div className="sticky-total">
        <div className="st-item keep">
          <span className="lbl">{filled} รายการ</span>
        </div>
        <div className="st-item grand">
          <span className="lbl">ยอดตั้งเจ้าหนี้</span>
          <span className="val">{baht(fromSatang(totals.total))}</span>
        </div>
        <div className="st-item keep">
          <span className="lbl">ต้องจ่ายจริง</span>
          <span className="val">{baht(fromSatang(totals.cashOut))}</span>
        </div>
      </div>

      <div className="toolbar form-actions" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={() => router.back()} disabled={pending}>
          ยกเลิก
        </button>
        <button type="button" className="btn primary" onClick={submit} disabled={pending}>
          {pending ? 'กำลังบันทึกและลงบัญชี…' : 'บันทึกและลงบัญชี'}
        </button>
      </div>

      <div className="keyhints">
        <span><kbd>Enter</kbd> ที่ช่องจำนวนเงิน = เพิ่มบรรทัดใหม่</span>
        <span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> บันทึก</span>
        <span><kbd>Alt</kbd>+<kbd>N</kbd> เพิ่มบรรทัด</span>
      </div>
    </>
  )
}
