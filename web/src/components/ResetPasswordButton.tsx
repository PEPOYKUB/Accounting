'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { resetUserPassword } from '@/lib/master'

export default function ResetPasswordButton({
  userId,
  username,
}: {
  userId: string
  username: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  if (!open) {
    return (
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>
        ตั้งรหัสผ่านใหม่
      </button>
    )
  }

  return (
    <div className="inline-editor">
      <div className="hint" style={{ marginBottom: 6 }}>
        ตั้งรหัสผ่านใหม่ให้ <strong>{username}</strong> — ระบบจะตัดทุกเซสชันของผู้ใช้รายนี้ทิ้ง
        และบังคับให้เปลี่ยนรหัสเองเมื่อเข้าครั้งถัดไป
      </div>
      {msg && (
        <div className={`alert ${msg.ok ? 'ok' : 'err'}`} style={{ marginBottom: 8 }}>
          <div>{msg.text}</div>
        </div>
      )}
      <input
        type="text"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="รหัสผ่านใหม่ อย่างน้อย 8 ตัว มีตัวเลข"
        autoComplete="off"
      />
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn primary sm"
          disabled={pending || pw.length < 8}
          onClick={() =>
            start(async () => {
              const res = await resetUserPassword(userId, pw)
              if (res.ok) {
                setMsg({ ok: true, text: res.message ?? 'ตั้งรหัสผ่านใหม่แล้ว' })
                setPw('')
                router.refresh()
              } else {
                setMsg({ ok: false, text: res.error })
              }
            })
          }
        >
          {pending ? 'กำลังบันทึก…' : 'ยืนยัน'}
        </button>
        <button type="button" className="btn sm" onClick={() => { setOpen(false); setMsg(null); setPw('') }}>
          ปิด
        </button>
      </div>
    </div>
  )
}
