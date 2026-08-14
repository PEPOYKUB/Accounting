'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { changePasswordAction, type FormState } from '@/lib/authActions'

const initial: FormState = {}

function strength(pw: string): { label: string; cls: string; pct: number } {
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (score <= 2) return { label: 'อ่อน', cls: 'danger', pct: 33 }
  if (score === 3) return { label: 'พอใช้', cls: 'warn', pct: 66 }
  return { label: 'แข็งแรง', cls: 'ok', pct: 100 }
}

export default function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [state, action, pending] = useActionState(changePasswordAction, initial)
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  const s = strength(next)
  const mismatch = confirm.length > 0 && next !== confirm

  return (
    <>
      {state.error && <div className="alert err"><div>{state.error}</div></div>}

      <form action={action}>
        <div className="field">
          <label htmlFor="current_password">รหัสผ่านปัจจุบัน</label>
          <input id="current_password" name="current_password" type="password"
            autoComplete="current-password" required autoFocus />
        </div>

        <div className="field">
          <label htmlFor="new_password">รหัสผ่านใหม่</label>
          <input id="new_password" name="new_password" type="password"
            autoComplete="new-password" required minLength={8}
            value={next} onChange={(e) => setNext(e.target.value)} />
          {next.length > 0 && (
            <>
              <div className="meter"><span className={s.cls} style={{ width: `${s.pct}%` }} /></div>
              <div className="hint">ความแข็งแรง: {s.label} · ต้องยาวอย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข</div>
            </>
          )}
        </div>

        <div className="field">
          <label htmlFor="confirm_password">ยืนยันรหัสผ่านใหม่</label>
          <input id="confirm_password" name="confirm_password" type="password"
            autoComplete="new-password" required
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {mismatch && <div className="hint" style={{ color: 'var(--danger)' }}>รหัสผ่านทั้งสองช่องไม่ตรงกัน</div>}
        </div>

        <div className="alert info">
          <div>เมื่อเปลี่ยนรหัสผ่านสำเร็จ ระบบจะออกจากระบบในเครื่องอื่นทั้งหมดโดยอัตโนมัติ</div>
        </div>

        <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
          {!forced && <Link className="btn" href="/">ยกเลิก</Link>}
          <button type="submit" className="btn primary" disabled={pending || mismatch}>
            {pending ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่านใหม่'}
          </button>
        </div>
      </form>
    </>
  )
}
