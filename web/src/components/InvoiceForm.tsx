'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createInvoice } from '@/lib/posting'
import { toSatang, fromSatang, pct, baht, today, addDays } from '@/lib/money'
import type { Account, Partner } from '@/lib/queries'

type Line = {
  description: string
  quantity: string
  unit_price: string
  revenue_account_code: string
  vat_rate: string
  cost_center_id: string
}

const blank = (defaultAccount: string): Line => ({
  description: '',
  quantity: '1',
  unit_price: '',
  revenue_account_code: defaultAccount,
  vat_rate: '7',
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
  const [whtRate, setWhtRate] = useState(customers[0]?.default_wht_rate ?? '3')
  const [lines, setLines] = useState<Line[]>([blank(defaultAccount)])

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

  function update(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  function onCustomer(id: string) {
    setCustomerId(id)
    const c = customers.find((x) => x.id === id)
    if (c) {
      setWhtRate(c.default_wht_rate ?? '3')
      setDueDate(addDays(issueDate, c.credit_days ?? 30))
    }
  }

  function submit() {
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
  }

  return (
    <>
      {error && <div className="alert err"><div>{error}</div></div>}

      <div className="alert info">
        <div>
          ตอนออกใบแจ้งหนี้ ภาษีมูลค่าเพิ่มจะเข้า <strong>บัญชีพักภาษีขาย (2101)</strong> ก่อน
          เพราะธุรกิจบริการมีจุดรับผิดทางภาษีเมื่อได้รับชำระเงิน ยังไม่เข้ารายงานภาษีขายและยังไม่ต้องยื่น ภพ.30
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label>ลูกค้า</label>
              <select value={customerId} onChange={(e) => onCustomer(e.target.value)}>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.partner_code} — {c.partner_name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>วันที่ออกเอกสาร</label>
              <input type="date" value={issueDate}
                onChange={(e) => { setIssueDate(e.target.value); setDueDate(addDays(e.target.value, 30)) }} />
            </div>
            <div className="field">
              <label>ครบกำหนดชำระ</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="field">
              <label>อัตราถูกหัก ณ ที่จ่าย (%)</label>
              <input type="text" inputMode="decimal" className="num" value={whtRate}
                onChange={(e) => setWhtRate(e.target.value)} />
              <div className="hint">ใช้ประมาณการเงินที่จะได้รับ ยังไม่ลงบัญชีจนกว่าจะรับชำระ</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          รายการ
          <button type="button" className="btn sm"
            onClick={() => setLines((p) => [...p, blank(defaultAccount)])}>+ เพิ่มบรรทัด</button>
        </div>
        <div className="table-wrap">
          <table className="tbl form-cards">
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>คำอธิบาย</th>
                <th style={{ width: 90 }}>จำนวน</th>
                <th style={{ width: 130 }}>ราคาต่อหน่วย</th>
                <th style={{ minWidth: 190 }}>บัญชีรายได้</th>
                {costCenters.length > 0 && <th style={{ width: 150 }}>ศูนย์ต้นทุน</th>}
                <th style={{ width: 80 }}>VAT %</th>
                <th className="num" style={{ width: 120 }}>รวม</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const amt = Math.round(toSatang(l.unit_price) * Number(l.quantity || '0'))
                return (
                  <tr key={i}>
                    <td data-label="คำอธิบาย"><input type="text" value={l.description}
                      onChange={(e) => update(i, { description: e.target.value })}
                      placeholder="เช่น ค่าที่ปรึกษาเดือนสิงหาคม" /></td>
                    <td data-label="จำนวน"><input type="text" inputMode="decimal" className="num" value={l.quantity}
                      onChange={(e) => update(i, { quantity: e.target.value })} /></td>
                    <td data-label="ราคาต่อหน่วย"><input type="text" inputMode="decimal" className="num" value={l.unit_price}
                      onChange={(e) => update(i, { unit_price: e.target.value })} /></td>
                    <td data-label="บัญชีรายได้">
                      <select value={l.revenue_account_code}
                        onChange={(e) => update(i, { revenue_account_code: e.target.value })}>
                        {revenueAccounts.map((a) => (
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
                          {costCenters.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td data-label="VAT %"><input type="text" inputMode="decimal" className="num" value={l.vat_rate}
                      onChange={(e) => update(i, { vat_rate: e.target.value })} /></td>
                    <td data-label="รวมบรรทัดนี้" className="num computed">{baht(fromSatang(amt))}</td>
                    <td className="line-remove">
                      {lines.length > 1 && (
                        <button type="button" className="btn sm danger"
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
