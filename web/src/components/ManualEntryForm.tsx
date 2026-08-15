'use client'

import { useState, useTransition, useMemo, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createManualEntry } from '@/lib/posting'
import { toSatang, fromSatang, baht, today } from '@/lib/money'
import type { Account } from '@/lib/queries'
import Combo, { type ComboOption } from '@/components/Combo'
import AmountInput from '@/components/AmountInput'
import FormShortcuts from '@/components/FormShortcuts'

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

  const accountRefs = useRef<(HTMLInputElement | null)[]>([])
  const focusLine = useRef<number | null>(null)

  useEffect(() => {
    const i = focusLine.current
    if (i == null) return
    focusLine.current = null
    accountRefs.current[i]?.focus()
  }, [lines.length])

  const accountOptions = useMemo<ComboOption[]>(
    () => accounts.map((a) => ({
      value: a.account_code,
      label: a.account_name,
      hint: a.account_code,
      keywords: a.account_code,
    })),
    [accounts]
  )

  const totals = useMemo(() => {
    const dr = lines.reduce((a, l) => a + toSatang(l.dr), 0)
    const cr = lines.reduce((a, l) => a + toSatang(l.cr), 0)
    return { dr, cr, diff: dr - cr }
  }, [lines])

  function update(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  const addLine = useCallback(() => {
    setLines((prev) => {
      focusLine.current = prev.length
      return [...prev, blank()]
    })
  }, [])

  /*
    เติมผลต่างให้อัตโนมัติ — ตัวช่วยที่นักบัญชีใช้บ่อยที่สุดตอนคีย์ใบสำคัญ
    คีย์ขาเดบิตครบแล้วกดปุ่มเดียว ระบบใส่ยอดเครดิตที่ทำให้ลงตัวให้เอง
    ใส่ลงบรรทัดแรกที่ยังว่างทั้งสองช่อง ถ้าไม่มีก็เปิดบรรทัดใหม่ให้
  */
  const fillDifference = useCallback(() => {
    const diff = totals.diff
    if (diff === 0) return
    const amount = fromSatang(Math.abs(diff))
    const side: 'dr' | 'cr' = diff > 0 ? 'cr' : 'dr'

    setLines((prev) => {
      const idx = prev.findIndex((l) => !toSatang(l.dr) && !toSatang(l.cr))
      if (idx >= 0) {
        return prev.map((l, i) => (i === idx ? { ...l, [side]: amount } : l))
      }
      return [...prev, { ...blank(), [side]: amount }]
    })
  }, [totals.diff])

  const submit = useCallback(() => {
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
  }, [entryDate, description, source, lines, router])

  const balanced = totals.diff === 0 && totals.dr > 0

  return (
    <>
      <FormShortcuts onSave={() => { if (balanced) submit() }} onAddLine={addLine} disabled={pending} />

      {error && <div className="alert err"><div>{error}</div></div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label htmlFor="je-date">วันที่</label>
              <input id="je-date" type="date" value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)} />
              <div className="hint">ระบบหางวดบัญชีจากวันที่ให้เอง และปฏิเสธถ้างวดนั้นปิดแล้ว</div>
            </div>
            <div className="field">
              <label htmlFor="je-source">ประเภทรายการ</label>
              <select id="je-source" value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label htmlFor="je-desc">คำอธิบายรายการ</label>
              <input id="je-desc" type="text" value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="เช่น ปรับปรุงค่าใช้จ่ายค้างจ่ายเดือนสิงหาคม" />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          บรรทัดรายการ
          <button type="button" className="btn sm" onClick={addLine}>+ เพิ่มบรรทัด</button>
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
              {lines.map((l, i) => {
                const isLast = i === lines.length - 1
                return (
                  <tr key={i}>
                    <td data-label="บัญชี">
                      <Combo
                        options={accountOptions}
                        value={l.account_code}
                        onChange={(v) => update(i, { account_code: v })}
                        allowEmpty
                        emptyLabel="— เลือกบัญชี —"
                        placeholder="พิมพ์รหัสหรือชื่อบัญชี"
                        inputRef={(el) => { accountRefs.current[i] = el }}
                      />
                    </td>
                    <td data-label="คำอธิบาย">
                      <input type="text" value={l.memo}
                        onChange={(e) => update(i, { memo: e.target.value })} />
                    </td>
                    <td data-label="เดบิต">
                      <AmountInput
                        value={l.dr}
                        ariaLabel="เดบิต"
                        onChange={(v) => update(i, { dr: v, cr: v ? '' : l.cr })}
                      />
                    </td>
                    <td data-label="เครดิต">
                      <AmountInput
                        value={l.cr}
                        ariaLabel="เครดิต"
                        onChange={(v) => update(i, { cr: v, dr: v ? '' : l.dr })}
                        onEnter={isLast ? addLine : undefined}
                      />
                    </td>
                    <td className="line-remove">
                      {lines.length > 2 && (
                        <button type="button" className="btn sm danger" title="ลบบรรทัดนี้"
                          onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}>✕</button>
                      )}
                    </td>
                  </tr>
                )
              })}
              <tr className="total">
                <td colSpan={2}>รวม</td>
                <td className="num">{baht(fromSatang(totals.dr))}</td>
                <td className="num">{baht(fromSatang(totals.cr))}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* สถานะสมดุลต้องเห็นตลอดเวลา ไม่ใช่ต้องเลื่อนหา
          เพราะเป็นเงื่อนไขเดียวที่ตัดสินว่าบันทึกได้หรือไม่ */}
      <div className="sticky-total">
        <div className="st-item">
          <span className="lbl">เดบิต</span>
          <span className="val">{baht(fromSatang(totals.dr))}</span>
        </div>
        <div className="st-item">
          <span className="lbl">เครดิต</span>
          <span className="val">{baht(fromSatang(totals.cr))}</span>
        </div>
        {totals.diff === 0 ? (
          <div className="st-item grand good keep">
            <span className="lbl">สถานะ</span>
            <span className="val">{totals.dr > 0 ? '✓ สมดุล' : 'ยังไม่มียอด'}</span>
          </div>
        ) : (
          <div className="st-item grand bad keep">
            <span className="lbl">ผลต่าง</span>
            <span className="val">{baht(fromSatang(Math.abs(totals.diff)))}</span>
            <button type="button" className="btn sm" onClick={fillDifference}
              title="ใส่ยอดที่ทำให้เดบิตเท่ากับเครดิต">
              เติมให้ลงตัว
            </button>
          </div>
        )}
      </div>

      <div className="toolbar form-actions" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={() => router.back()} disabled={pending}>
          ยกเลิก
        </button>
        <button type="button" className="btn primary" onClick={submit} disabled={pending || !balanced}>
          {pending ? 'กำลังลงบัญชี…' : 'ลงบัญชี'}
        </button>
      </div>

      <div className="keyhints">
        <span><kbd>Enter</kbd> ที่ช่องเครดิตบรรทัดสุดท้าย = เพิ่มบรรทัด</span>
        <span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> ลงบัญชี</span>
        <span><kbd>Alt</kbd>+<kbd>N</kbd> เพิ่มบรรทัด</span>
      </div>
    </>
  )
}
