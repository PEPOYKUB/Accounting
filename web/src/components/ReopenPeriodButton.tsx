'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reopenPeriod } from '@/lib/master'

export default function ReopenPeriodButton({
  periodId,
  periodLabel,
}: {
  periodId: string
  periodLabel: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!confirming) {
    return (
      <button type="button" className="btn sm" onClick={() => setConfirming(true)}>
        เปิดงวดกลับ
      </button>
    )
  }

  return (
    <div className="inline-editor">
      <div className="alert warn" style={{ marginBottom: 8 }}>
        <div>
          เปิดงวด <strong>{periodLabel}</strong> กลับมาแก้ไข — ควรทำเฉพาะเมื่อยังไม่ได้ยื่นงบหรือภาษีของงวดนั้น
          เพราะรายงานที่พิมพ์ไปแล้วอาจไม่ตรงกับระบบอีกต่อไป · การเปิดงวดถูกบันทึกไว้ใน Audit Log
        </div>
      </div>
      {error && <div className="alert err" style={{ marginBottom: 8 }}><div>{error}</div></div>}
      <div className="toolbar">
        <button
          type="button"
          className="btn danger sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null)
              const res = await reopenPeriod(periodId)
              if (res.ok) { setConfirming(false); router.refresh() }
              else setError(res.error)
            })
          }
        >
          {pending ? 'กำลังเปิด…' : 'ยืนยันเปิดงวด'}
        </button>
        <button type="button" className="btn sm" onClick={() => setConfirming(false)}>ยกเลิก</button>
      </div>
    </div>
  )
}
