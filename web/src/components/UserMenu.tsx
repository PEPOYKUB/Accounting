'use client'

import Link from 'next/link'
import { useState, useTransition, useRef, useEffect } from 'react'
import { logoutAction } from '@/lib/authActions'
import { ROLE_TH, type AuthUser } from '@/lib/roles'

export default function UserMenu({ user }: { user: AuthUser }) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const initials = user.full_name.trim().charAt(0) || '?'

  return (
    <div className="usermenu" ref={ref}>
      <button type="button" className="usermenu-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="avatar">{initials}</span>
        <span className="usermenu-name">
          {user.full_name}
          <small>{user.roles.map((r) => ROLE_TH[r] ?? r).join(', ') || 'ไม่มีบทบาท'}</small>
        </span>
        <span className="muted" style={{ fontSize: 10 }}>▼</span>
      </button>

      {open && (
        <div className="usermenu-panel">
          <div className="usermenu-head">
            <strong>{user.full_name}</strong>
            <div className="muted" style={{ fontSize: 12 }}>@{user.username}</div>
            {user.email && <div className="muted" style={{ fontSize: 12 }}>{user.email}</div>}
          </div>
          <Link href="/account" className="usermenu-item" onClick={() => setOpen(false)}>
            บัญชีของฉันและเซสชัน
          </Link>
          <Link href="/change-password" className="usermenu-item" onClick={() => setOpen(false)}>
            เปลี่ยนรหัสผ่าน
          </Link>
          <button
            type="button"
            className="usermenu-item danger"
            disabled={pending}
            onClick={() => start(() => { void logoutAction() })}
          >
            {pending ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ'}
          </button>
        </div>
      )}
    </div>
  )
}
