'use client'

/*
  ช่องเลือกที่พิมพ์ค้นหาได้ — ใช้แทน <select> ทุกที่ที่ตัวเลือกเกิน ~8 รายการ

  เหตุผล: ผังบัญชีมี 79 บัญชี ลูกค้าจริงมีเป็นร้อยราย
  <select> ของเบราว์เซอร์ต้องเลื่อนหา ทำให้คีย์ข้อมูลช้าและเลือกผิดบัญชีได้ง่าย

  พฤติกรรมที่ตั้งใจให้เป็น
  - พิมพ์เพื่อกรอง ค้นได้ทั้งรหัสและชื่อไทย ไม่สนช่องว่าง
  - ลูกศรขึ้นลงเลื่อน Enter เลือก Esc ปิด Tab เลือกตัวที่ไฮไลต์อยู่แล้วไปช่องถัดไป
  - ออกจากช่องโดยยังไม่ได้เลือก จะดีดกลับเป็นค่าเดิมเสมอ ไม่ปล่อยให้ค้างเป็นค่าว่าง
    (งานบัญชีผิดไม่ได้ ค่าครึ่ง ๆ กลาง ๆ อันตรายกว่าการบังคับให้เลือกใหม่)
*/

import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
} from 'react'

export type ComboOption = {
  value: string
  label: string
  /** ข้อความรองที่แสดงทางขวา เช่น ชื่อย่อประเภทบัญชี */
  hint?: string
  /** คำค้นเพิ่มเติมที่ไม่ได้แสดงผล */
  keywords?: string
}

/** ตัดช่องว่างและทำตัวพิมพ์เล็ก เพื่อให้ "1 100" หา "1100" เจอ */
function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, '')
}

function score(opt: ComboOption, needle: string): number {
  if (!needle) return 0
  const n = norm(needle)
  const value = norm(opt.value)
  const label = norm(opt.label)
  const extra = norm(opt.keywords ?? '')

  if (value === n) return 0            // รหัสตรงเป๊ะ มาก่อนเสมอ
  if (value.startsWith(n)) return 1
  if (label.startsWith(n)) return 2
  if (label.includes(n)) return 3
  if (extra.includes(n)) return 4
  return -1                            // ไม่ตรงเลย
}

export default function Combo({
  options,
  value,
  onChange,
  placeholder = 'พิมพ์เพื่อค้นหา',
  id,
  disabled,
  allowEmpty,
  emptyLabel = '— ไม่ระบุ —',
  autoFocus,
  className,
  inputRef: exposeRef,
}: {
  options: ComboOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  id?: string
  disabled?: boolean
  /** ให้เลือก "ไม่ระบุ" ได้ เช่น ศูนย์ต้นทุน */
  allowEmpty?: boolean
  emptyLabel?: string
  autoFocus?: boolean
  className?: string
  /** ส่ง element ออกไปให้ฟอร์มสั่งโฟกัสเองได้ เช่น ตอนเพิ่มบรรทัดใหม่ */
  inputRef?: (el: HTMLInputElement | null) => void
}) {
  const reactId = useId()
  const listId = `${id ?? reactId}-list`

  const all = useMemo<ComboOption[]>(
    () => (allowEmpty ? [{ value: '', label: emptyLabel }, ...options] : options),
    [options, allowEmpty, emptyLabel]
  )

  const selected = all.find((o) => o.value === value)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const matches = useMemo(() => {
    if (!query) return all
    return all
      .map((o) => ({ o, s: score(o, query) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s)
      .map((x) => x.o)
  }, [all, query])

  // ปิดรายการแล้วคืนค่าเดิมเสมอ กันค่าค้างครึ่ง ๆ กลาง ๆ
  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  const pick = useCallback(
    (opt: ComboOption | undefined) => {
      if (!opt) return
      onChange(opt.value)
      close()
    },
    [onChange, close]
  )

  useEffect(() => {
    if (!open) return
    function onDocDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open, close])

  // เลื่อนรายการที่ไฮไลต์ให้อยู่ในสายตาเสมอ
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  useEffect(() => {
    setActive(0)
  }, [query])

  // แอตทริบิวต์ autoFocus ของ React ไม่ทำงานสม่ำเสมอตอน hydrate ฝั่ง App Router
  // จึงสั่งโฟกัสเองหลัง mount ให้เริ่มพิมพ์ได้ทันทีโดยไม่ต้องคลิกก่อน
  useEffect(() => {
    if (!autoFocus || disabled) return
    const el = inputRef.current
    if (!el) return
    const t = setTimeout(() => el.focus(), 0)
    return () => clearTimeout(t)
    // ตั้งใจให้ทำงานครั้งเดียวตอน mount เท่านั้น
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openList() {
    if (disabled) return
    setOpen(true)
    setQuery('')
    // เริ่มไฮไลต์ที่ตัวที่เลือกอยู่ จะได้กด Enter ซ้ำโดยค่าไม่เปลี่ยน
    const idx = all.findIndex((o) => o.value === value)
    setActive(idx >= 0 ? idx : 0)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { openList(); return }
      const dir = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => {
        const next = i + dir
        if (next < 0) return matches.length - 1
        if (next >= matches.length) return 0
        return next
      })
      return
    }

    if (e.key === 'Enter') {
      if (open) {
        e.preventDefault()
        // กัน Enter หลุดไป submit ฟอร์มทั้งใบตอนกำลังเลือกอยู่
        e.stopPropagation()
        pick(matches[active])
      }
      return
    }

    if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); close() }
      return
    }

    if (e.key === 'Tab') {
      // Tab ระหว่างเปิดรายการ = ยืนยันตัวที่ไฮไลต์ แล้วไปช่องถัดไปตามปกติ
      if (open && matches[active]) pick(matches[active])
      return
    }
  }

  const shown = open ? query : (selected?.label ?? '')

  return (
    <div className={`combo${className ? ' ' + className : ''}`} ref={rootRef}>
      <input
        ref={(el) => { inputRef.current = el; exposeRef?.(el) }}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        disabled={disabled}
        autoFocus={autoFocus}
        className={`combo-input${open ? ' is-open' : ''}`}
        placeholder={selected ? undefined : placeholder}
        value={shown}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true) }}
        onFocus={openList}
        onClick={openList}
        onBlur={() => { if (open) close() }}
        onKeyDown={onKeyDown}
      />
      <span className="combo-caret" aria-hidden="true">▾</span>

      {open && (
        <ul className="combo-list" id={listId} role="listbox" ref={listRef}>
          {matches.length === 0 && (
            <li className="combo-empty" role="presentation">ไม่พบรายการที่ค้นหา</li>
          )}
          {matches.map((o, i) => (
            <li
              key={o.value || '__empty__'}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`combo-opt${i === active ? ' is-active' : ''}${o.value === value ? ' is-current' : ''}`}
              // ใช้ mouseDown เพราะ click มาหลัง blur ซึ่งปิดรายการไปแล้ว
              onMouseDown={(e) => { e.preventDefault(); pick(o) }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="combo-opt-label">{o.label}</span>
              {o.hint && <span className="combo-opt-hint">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
