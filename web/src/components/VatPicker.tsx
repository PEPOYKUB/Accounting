'use client'

/*
  เลือกอัตราภาษีมูลค่าเพิ่ม

  เดิมเป็นช่องกรอกตัวเลขอิสระ ซึ่งช้าและพิมพ์ผิดได้ง่าย เช่น 70 แทน 7
  ในทางปฏิบัติของไทยมีแค่สามกรณี คือ 7% · 0% (ส่งออก) · ยกเว้นภาษี
  จึงทำเป็นปุ่มให้กดทีเดียว แต่ยังเปิดช่องกรอกเองไว้เผื่ออัตราเปลี่ยนในอนาคต
*/

import { useState } from 'react'

const PRESETS = [
  { rate: '7', label: '7%' },
  { rate: '0', label: '0%' },
] as const

export default function VatPicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const isPreset = PRESETS.some((p) => Number(p.rate) === Number(value || '0'))
  const [custom, setCustom] = useState(!isPreset)

  if (custom) {
    return (
      <div className="vat-custom">
        <input
          type="text"
          inputMode="decimal"
          className="num"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label="อัตราภาษีมูลค่าเพิ่ม (%)"
        />
        <button type="button" className="btn sm" disabled={disabled}
          onClick={() => { setCustom(false); onChange('7') }}>
          กลับไปเลือก
        </button>
      </div>
    )
  }

  return (
    <div className="seg" role="group" aria-label="อัตราภาษีมูลค่าเพิ่ม">
      {PRESETS.map((p) => (
        <button
          key={p.rate}
          type="button"
          disabled={disabled}
          className={Number(value || '0') === Number(p.rate) ? 'on' : ''}
          aria-pressed={Number(value || '0') === Number(p.rate)}
          onClick={() => onChange(p.rate)}
        >
          {p.label}
        </button>
      ))}
      <button type="button" disabled={disabled} title="กรอกอัตราเอง"
        onClick={() => setCustom(true)}>
        อื่น ๆ
      </button>
    </div>
  )
}
