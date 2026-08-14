'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { Result } from '@/lib/master'

/**
 * กล่องจัดการข้อมูลหลักแบบใช้ซ้ำ
 * รับฟอร์มเป็น children แล้วจัดการสถานะกำลังบันทึก ข้อความผิดพลาด และการรีเฟรชให้
 */
export function CrudForm({
  title,
  action,
  children,
  submitLabel = 'บันทึก',
  onDone,
  compact,
}: {
  title?: string
  action: (fd: FormData) => Promise<Result>
  children: ReactNode
  submitLabel?: string
  onDone?: () => void
  compact?: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  return (
    <form
      action={(fd) => {
        setError(null)
        setOkMsg(null)
        start(async () => {
          const res = await action(fd)
          if (res.ok) {
            setOkMsg(res.message ?? 'บันทึกแล้ว')
            router.refresh()
            onDone?.()
          } else {
            setError(res.error)
          }
        })
      }}
    >
      {title && <div className="card-head">{title}</div>}
      <div className={compact ? '' : 'card-body'}>
        {error && <div className="alert err"><div>{error}</div></div>}
        {okMsg && <div className="alert ok"><div>{okMsg}</div></div>}
        {children}
        <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? 'กำลังบันทึก…' : submitLabel}
          </button>
        </div>
      </div>
    </form>
  )
}

/** ปุ่มเปิด/ปิดใช้งานแถวข้อมูล */
export function ToggleButton({
  id,
  active,
  action,
  labelOn = 'ใช้งานอยู่',
  labelOff = 'ปิดใช้งาน',
}: {
  id: string
  active: boolean
  action: (id: string, active: boolean) => Promise<Result>
  labelOn?: string
  labelOff?: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <button
        type="button"
        className={`btn sm${active ? '' : ' danger'}`}
        disabled={pending}
        title={active ? 'คลิกเพื่อปิดใช้งาน' : 'คลิกเพื่อเปิดใช้งาน'}
        onClick={() =>
          start(async () => {
            setError(null)
            const res = await action(id, !active)
            if (res.ok) router.refresh()
            else setError(res.error)
          })
        }
      >
        {pending ? '…' : active ? labelOn : labelOff}
      </button>
      {error && <div className="hint" style={{ color: 'var(--danger)' }}>{error}</div>}
    </>
  )
}

/** แผงพับเปิด-ปิด ใช้ซ่อนฟอร์มเพิ่มข้อมูลไว้ให้หน้าไม่รก */
export function Collapsible({
  label,
  children,
  defaultOpen,
}: {
  label: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <button
        type="button"
        className="card-head"
        style={{ width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{label}</span>
        <span className="muted">{open ? '▲' : '▼'}</span>
      </button>
      {open && children}
    </div>
  )
}
