'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createManualEntry } from '@/lib/posting'
import { toSatang, fromSatang, baht, today } from '@/lib/money'
import type { Account } from '@/lib/queries'

type Line = { account_code: string; dr: string; cr: string; memo: string }

const blank = (): Line => ({ account_code: '', dr: '', cr: '', memo: '' })

const SOURCES = [
  ['MANUAL', 'ลงบัญชีมือ'],
  ['ADJUSTMENT', 'รายการปรับปรุงสิ้นงวด'],
  ['TAX_REMITTANCE', 'นำส่งภาษี'],
  ['BANK', 'รายการธนาคาร'],
  ['PAYROLL', 'เงินเดือน'],
  ['DEPRECIATION', 'ค่าเสื่อมราคา'],
  ['CLOSING', 'ปิดบัญชี'],
] as const

export default function ManualEntryForm({ accounts }: { accounts: Account[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [entryDate, setEntryDate] = useState(today())
  const [description, setDescription] = useState('')
  const [source, setSource] = useState<string>('MANUAL')
  const [lines, setLines] = useState<Line[]>([blank(), blank()])

  const totals = useMemo(() => {
    const dr = lines.reduce((a, l) => a + toSatang(l.dr), 0)
    const cr = lines.reduce((a, l) => a + toSatang(l.cr), 0)
    return { dr, cr, diff: dr - cr }
  }, [lines])

  function update(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('entry_date', entryDate)
    fd.set('description', description)
    fd.set('source_type', source)
    fd.set('lines', JSON.stringify(lines))

    start(async () => {
      const res = await createManualEntry(fd)
      if (res.ok) router.push(`/journal?created=${encodeURIComponent(res.docNo)}`)
      else setError(res.error)
    })
  }

  const balanced = totals.diff === 0 && totals.dr > 0

  return (
    <>
      {error && <div className="alert err"><div>{error}</div></div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label>วันที่</label>
              <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              <div className="hint">ระบบหางวดบัญชีจากวันที่ให้เอง และปฏิเสธถ้างวดนั้นปิดแล้ว</div>
            </div>
            <div className="field">
              <label>ประเภทรายการ</label>
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label>คำอธิบายรายการ</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="เช่น ปรับปรุงค่าใช้จ่ายค้างจ่ายเดือนสิงหาคม" />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          บรรทัดรายการ
          <button type="button" className="btn sm" onClick={() => setLines((p) => [...p, blank()])}>
            + เพิ่มบรรทัด
          </button>
        </div>
        <div className="table-wrap">
          <table className="tbl form-cards">
            <thead>
              <tr>
                <th style={{ minWidth: 260 }}>บัญชี</th>
                <th style={{ minWidth: 180 }}>คำอธิบาย</th>
                <th className="num" style={{ width: 140 }}>เดบิต</th>
                <th className="num" style={{ width: 140 }}>เครดิต</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td data-label="บัญชี">
                    <select value={l.account_code} onChange={(e) => update(i, { account_code: e.target.value })}>
                      <option value="">— เลือกบัญชี —</option>
                      {accounts.map((a) => (
                        <option key={a.account_code} value={a.account_code}>
                          {a.account_code} {a.account_name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="คำอธิบาย">
                    <input type="text" value={l.memo} onChange={(e) => update(i, { memo: e.target.value })} />
                  </td>
                  <td data-label="เดบิต">
                    <input type="text" inputMode="decimal" className="num" value={l.dr}
                      onChange={(e) => update(i, { dr: e.target.value, cr: e.target.value ? '' : l.cr })} />
                  </td>
                  <td data-label="เครดิต">
                    <input type="text" inputMode="decimal" className="num" value={l.cr}
                      onChange={(e) => update(i, { cr: e.target.value, dr: e.target.value ? '' : l.dr })} />
                  </td>
                  <td className="line-remove">
                    {lines.length > 2 && (
                      <button type="button" className="btn sm danger"
                        onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="total">
                <td colSpan={2}>รวม</td>
                <td className="num">{baht(fromSatang(totals.dr))}</td>
                <td className="num">{baht(fromSatang(totals.cr))}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
          {totals.diff !== 0 ? (
            <div className="alert err" style={{ marginBottom: 12 }}>
              <div>เดบิตไม่เท่ากับเครดิต ผลต่าง {baht(fromSatang(Math.abs(totals.diff)))} บาท — ระบบจะไม่ยอมบันทึก</div>
            </div>
          ) : (
            totals.dr > 0 && (
              <div className="alert ok" style={{ marginBottom: 12 }}>
                <div>เดบิตเท่ากับเครดิต พร้อมลงบัญชี</div>
              </div>
            )
          )}
          <div className="toolbar form-actions" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => router.back()} disabled={pending}>ยกเลิก</button>
            <button type="button" className="btn primary" onClick={submit} disabled={pending || !balanced}>
              {pending ? 'กำลังลงบัญชี…' : 'ลงบัญชี'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
