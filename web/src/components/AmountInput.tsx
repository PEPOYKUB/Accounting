'use client'

/*
  ช่องกรอกจำนวนเงิน

  สามอย่างที่ช่วยให้คีย์ข้อมูลเร็วและตรวจตาเลขได้ง่ายขึ้น
  1) พอออกจากช่อง จัดรูปเป็น 1,234.56 ให้เลย แต่ตอนพิมพ์ยังเป็นตัวเลขดิบเพื่อไม่ให้เคอร์เซอร์กระโดด
  2) โฟกัสแล้วเลือกข้อความทั้งหมด พิมพ์ทับได้เลยไม่ต้องลบก่อน
  3) รับเครื่องหมายจุลภาคที่ติดมาจากการคัดลอกวางจากเอกสารอื่น

  ค่าที่ส่งออกทาง onChange เป็นตัวเลขดิบเสมอ ไม่มีจุลภาค
  เพราะ toSatang ปลายทางต้องการรูปแบบนั้น
*/

import { useState } from 'react'

function clean(s: string) {
  return s.replace(/,/g, '').trim()
}

function display(raw: string) {
  const v = clean(raw)
  if (!v) return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return raw
  const [int, dec] = v.split('.')
  const withSep = Number(int || '0').toLocaleString('en-US')
  return dec != null ? `${withSep}.${dec}` : withSep
}

export default function AmountInput({
  value,
  onChange,
  onEnter,
  disabled,
  placeholder,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  /** เรียกเมื่อกด Enter เช่น ใช้เปิดบรรทัดใหม่ */
  onEnter?: () => void
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
}) {
  const [editing, setEditing] = useState(false)

  return (
    <input
      type="text"
      inputMode="decimal"
      className="num"
      disabled={disabled}
      placeholder={placeholder ?? '0.00'}
      aria-label={ariaLabel}
      value={editing ? value : display(value)}
      onFocus={(e) => { setEditing(true); e.currentTarget.select() }}
      onBlur={() => setEditing(false)}
      onChange={(e) => onChange(clean(e.target.value))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) {
          e.preventDefault()
          onEnter()
        }
      }}
    />
  )
}
