'use client'

import { useState, useTransition, useMemo, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createInvoice } from '@/lib/posting'
import { toSatang, fromSatang, pct, baht, today, addDays } from '@/lib/money'
import type { Account, Partner } from '@/lib/queries'
import { normRate } from '@/lib/rates'
import Combo, { type ComboOption } from '@/components/Combo'
import VatPicker from '@/components/VatPicker'
import AmountInput from '@/components/AmountInput'
import FormShortcuts from '@/components/FormShortcuts'

type Line = {
  description: string
  quantity: string
  unit_price: string
  revenue_account_code: string
  vat_rate: string
  cost_center_id: string
}

const blank = (defaultAccount: string, vat = '7'): Line => ({
  description: '',
  quantity: '1',
  unit_price: '',
  revenue_account_code: defaultAccount,
  vat_rate: vat,
  cost_center_id: '',
})

export default function InvoiceForm({
  customers,
  revenueAccounts,
  costCenters,
}: {
  customers: Partner[]
  revenueAccounts: Account[]
  costCenters: { id: string; code: string; name: string }[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const defaultAccount = revenueAccounts[0]?.account_code ?? ''
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '')
  const [issueDate, setIssueDate] = useState(today())
  const [dueDate, setDueDate] = useState(addDays(today(), 30))
  const [whtRate, setWhtRate] = useState(normRate(customers[0]?.default_wht_rate))
  const [lines, setLines] = useState<Line[]>([blank(defaultAccount)])

  // ใช้โฟกัสช่องคำอธิบายของบรรทัดที่เพิ่งเพิ่ม เพื่อคีย์ต่อได้เลยไม่ต้องเอื้อมเมาส์
  const lineRefs = useRef<(HTMLInputElement | null)[]>([])
  // จำว่าจะโฟกัสบรรทัดไหน แล้วค่อยโฟกัสหลัง React วาดเสร็จ
  // เชื่อถือได้กว่าการเดาตำแหน่งจากความยาว array ซึ่งมี ref ค้างจากบรรทัดที่ถูกลบไปแล้ว
  const focusLine = useRef<number | null>(null)

  useEffect(() => {
    const i = focusLine.current
    if (i == null) return
    focusLine.current = null
    lineRefs.current[i]?.focus()
  }, [lines.length])

  const customerOptions = useMemo<ComboOption[]>(
    () => customers.map((c) => ({
      value: c.id,
      label: c.partner_name,
      hint: c.partner_code,
      keywords: c.partner_code,
    })),
    [customers]
  )

  const accountOptions = useMemo<ComboOption[]>(
    () => revenueAccounts.map((a) => ({
      value: a.account_code,
      label: a.account_name,
      hint: a.account_code,
      keywords: a.account_code,
    })),
    [revenueAccounts]
  )

  const costCenterOptions = useMemo<ComboOption[]>(
    () => costCenters.map((c) => ({ value: c.id, label: c.name, hint: c.code, keywords: c.code })),
    [costCenters]
  )

  const totals = useMemo(() => {
    let sub = 0
    let vat = 0
    for (const l of lines) {
      const amt = Math.round(toSatang(l.unit_price) * Number(l.quantity || '0'))
      sub += amt
      vat += pct(amt, l.vat_rate || '0')
    }
    const wht = pct(sub, whtRate || '0')
    return { sub, vat, total: sub + vat, wht, expectedCash: sub + vat - wht }
  }, [lines, whtRate])

  const filled = lines.filter((l) => toSatang(l.unit_price) > 0 && l.description.trim()).length

  function update(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  const addLine = useCallback((copyFrom?: number) => {
    setLines((prev) => {
      const src = copyFrom != null ? prev[copyFrom] : undefined
      // บรรทัดใหม่สืบทอดบัญชีรายได้ VAT และศูนย์ต้นทุนจากบรรทัดล่าสุด
      // เพราะใบแจ้งหนี้ใบเดียวกันมักใช้บัญชีเดียวกันทุกบรรทัด
      const last = prev[prev.length - 1]
      const next: Line = src
        ? { ...src }
        : {
            ...blank(last?.revenue_account_code || defaultAccount, last?.vat_rate ?? '7'),
            cost_center_id: last?.cost_center_id ?? '',
          }
      focusLine.current = prev.length
      return [...prev, next]
    })
  }, [defaultAccount])

  function onCustomer(id: string) {
    setCustomerId(id)
    const c = customers.find((x) => x.id === id)
    if (c) {
      setWhtRate(normRate(c.default_wht_rate))
      setDueDate(addDays(issueDate, c.credit_days ?? 30))
    }
  }

  const submit = useCallback(() => {
    setError(null)
    const clean = lines.filter((l) => toSatang(l.unit_price) > 0 && l.description.trim())
    if (clean.length === 0) {
      setError('ต้องกรอกรายการอย่างน้อย 1 บรรทัด พร้อมคำอธิบายและจำนวนเงิน')
      return
    }

    const fd = new FormData()
    fd.set('customer_id', customerId)
    fd.set('issue_date', issueDate)
    fd.set('due_date', dueDate)
    fd.set('expected_wht_rate', whtRate)
    fd.set('lines', JSON.stringify(clean))

    start(async () => {
      const res = await createInvoice(fd)
      if (res.ok) router.push(`/invoices?created=${encodeURIComponent(res.docNo)}`)
      else setError(res.error)
    })
  }, [lines, customerId, issueDate, dueDate, whtRate, router])

  const customer = customers.find((c) => c.id === customerId)

  return (
    <>
      <FormShortcuts onSave={submit} onAddLine={() => addLine()} disabled={pending} />

      {error && <div className="alert err"><div>{error}</div></div>}

      <details className="explain">
        <summary>ใบแจ้งหนี้นี้จะลงบัญชีอย่างไร</summary>
        <div className="explain-body">
          ภาษีมูลค่าเพิ่มจะเข้า <strong>บัญชีพักภาษีขาย (2101)</strong> ก่อน
          เพราะธุรกิจบริการมีจุดรับผิดทางภาษีเมื่อได้รับชำระเงิน
          ยังไม่เข้ารายงานภาษีขายและยังไม่ต้องยื่น ภพ.30 จนกว่าจะรับชำระ
          <br />
          ภาษีหัก ณ ที่จ่ายด้านล่างเป็นเพียงตัวเลขประมาณการเงินที่จะได้รับ ยังไม่ลงบัญชีในขั้นนี้
        </div>
      </details>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label htmlFor="inv-customer">ลูกค้า</label>
              <Combo
                id="inv-customer"
                options={customerOptions}
                value={customerId}
                onChange={onCustomer}
                placeholder="พิมพ์ชื่อหรือรหัสลูกค้า"
                autoFocus
              />
              {customer && (
                <div className="hint">
                  เครดิต {customer.credit_days ?? 30} วัน
                  {customer.tax_id ? ` · เลขผู้เสียภาษี ${customer.tax_id}` : ''}
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="inv-issue">วันที่ออกเอกสาร</label>
              <input id="inv-issue" type="date" value={issueDate}
                onChange={(e) => {
                  setIssueDate(e.target.value)
                  setDueDate(addDays(e.target.value, customer?.credit_days ?? 30))
                }} />
            </div>
            <div className="field">
              <label htmlFor="inv-due">ครบกำหนดชำระ</label>
              <input id="inv-due" type="date" value={dueDate}
                onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="inv-wht">อัตราถูกหัก ณ ที่จ่าย (%)</label>
              <input id="inv-wht" type="text" inputMode="decimal" className="num"
                value={whtRate} onChange={(e) => setWhtRate(e.target.value)} />
              <div className="hint">ประมาณการเท่านั้น ลงบัญชีจริงตอนรับชำระ</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          รายการ
          <button type="button" className="btn sm" onClick={() => addLine()}>
            + เพิ่มบรรทัด
          </button>
        </div>
        <div className="table-wrap">
          <table className="tbl form-cards">
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>คำอธิบาย</th>
                <th style={{ width: 80 }}>จำนวน</th>
                <th style={{ width: 130 }}>ราคาต่อหน่วย</th>
                <th style={{ minWidth: 190 }}>บัญชีรายได้</th>
                {costCenters.length > 0 && <th style={{ width: 150 }}>ศูนย์ต้นทุน</th>}
                <th style={{ width: 150 }}>ภาษีมูลค่าเพิ่ม</th>
                <th className="num" style={{ width: 120 }}>รวม</th>
                <th style={{ width: 66 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const amt = Math.round(toSatang(l.unit_price) * Number(l.quantity || '0'))
                const isLast = i === lines.length - 1
                return (
                  <tr key={i}>
                    <td data-label="คำอธิบาย">
                      <input
                        type="text"
                        ref={(el) => { lineRefs.current[i] = el }}
                        value={l.description}
                        onChange={(e) => update(i, { description: e.target.value })}
                        placeholder="เช่น ค่าที่ปรึกษาเดือนสิงหาคม"
                      />
                    </td>
                    <td data-label="จำนวน">
                      <input type="text" inputMode="decimal" className="num" value={l.quantity}
                        onChange={(e) => update(i, { quantity: e.target.value })} />
                    </td>
                    <td data-label="ราคาต่อหน่วย">
                      <AmountInput
                        value={l.unit_price}
                        onChange={(v) => update(i, { unit_price: v })}
                        // Enter ที่ช่องเงินของบรรทัดสุดท้าย = เปิดบรรทัดใหม่ทันที
                        onEnter={isLast ? () => addLine() : undefined}
                      />
                    </td>
                    <td data-label="บัญชีรายได้">
                      <Combo
                        options={accountOptions}
                        value={l.revenue_account_code}
                        onChange={(v) => update(i, { revenue_account_code: v })}
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
                    <td data-label="ภาษีมูลค่าเพิ่ม">
                      <VatPicker value={l.vat_rate} onChange={(v) => update(i, { vat_rate: v })} />
                    </td>
                    <td data-label="รวมบรรทัดนี้" className="num computed">
                      {baht(fromSatang(amt))}
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
                <tr className="total"><td>ยอดรวมทั้งสิ้น</td><td className="num">{baht(fromSatang(totals.total))}</td></tr>
                <tr><td className="muted">หัก ณ ที่จ่าย (ประมาณการ)</td>
                  <td className="num muted">({baht(fromSatang(totals.wht))})</td></tr>
                <tr><td className="muted">คาดว่าจะได้รับ</td>
                  <td className="num muted">{baht(fromSatang(totals.expectedCash))}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* แถบนี้ติดขอบล่างเสมอ ไม่ต้องเลื่อนกลับขึ้นไปดูยอด
          เลือกแสดงเฉพาะตัวเลขที่ต้องตัดสินใจจริง ๆ รายละเอียดที่เหลือดูในกล่องสรุปด้านบน */}
      <div className="sticky-total">
        <div className="st-item keep">
          <span className="lbl">{filled} รายการ</span>
        </div>
        <div className="st-item grand">
          <span className="lbl">ยอดรวมทั้งสิ้น</span>
          <span className="val">{baht(fromSatang(totals.total))}</span>
        </div>
        <div className="st-item keep">
          <span className="lbl">คาดว่าจะได้รับ</span>
          <span className="val">{baht(fromSatang(totals.expectedCash))}</span>
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
        <span><kbd>Enter</kbd> ที่ช่องราคา = เพิ่มบรรทัดใหม่</span>
        <span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> บันทึก</span>
        <span><kbd>Alt</kbd>+<kbd>N</kbd> เพิ่มบรรทัด</span>
        <span>พิมพ์ในช่องลูกค้าและบัญชีเพื่อค้นหา</span>
      </div>
    </>
  )
}
