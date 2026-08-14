'use client'

import { useActionState, useState } from 'react'
import { loginAction, type FormState } from '@/lib/authActions'

const initial: FormState = {}

export default function LoginForm({
  demoMode,
  demoUsers,
}: {
  demoMode: boolean
  demoUsers: { username: string; full_name: string; roles: string[] }[]
}) {
  const [state, action, pending] = useActionState(loginAction, initial)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">฿</div>
          <div>
            <h1>ระบบบัญชี</h1>
            <p>ระบบบัญชีคู่เต็มรูปแบบ · ธุรกิจบริการ · TFRS for NPAEs</p>
          </div>
        </div>

        {state.error && (
          <div className="alert err"><div>{state.error}</div></div>
        )}

        <form action={action}>
          <div className="field">
            <label htmlFor="username">ชื่อผู้ใช้</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">รหัสผ่าน</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={pending}>
            {pending ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบ'}
          </button>
        </form>

        {demoMode && demoUsers.length > 0 && (
          <div className="demo-box">
            <div className="demo-title">
              <span className="badge warn">โหมดสาธิต</span>
              <span>บัญชีทดลอง — รหัสผ่านทุกบัญชีคือ <code>Demo@2569</code></span>
            </div>
            <table className="tbl" style={{ marginTop: 8 }}>
              <tbody>
                {demoUsers.map((u) => (
                  <tr key={u.username}>
                    <td style={{ padding: '6px 8px' }}>
                      <code>{u.username}</code>
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {u.full_name}
                      <div className="muted" style={{ fontSize: 11 }}>{u.roles.join(', ') || '—'}</div>
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => { setUsername(u.username); setPassword('Demo@2569') }}
                      >
                        กรอกให้
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 11.5, margin: '10px 0 0' }}>
              ระบบจะบังคับให้ตั้งรหัสผ่านใหม่เมื่อเข้าสู่ระบบครั้งแรก ·
              ปิดกล่องนี้ได้โดยตั้ง <code>DEMO_MODE=false</code>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
