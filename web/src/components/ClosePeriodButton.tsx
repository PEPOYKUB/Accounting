'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { closePeriod } from '@/lib/posting'

export default function ClosePeriodButton({
  periodId,
  periodLabel,
  disabled,
}: {
  periodId: string
  periodLabel: string
  disabled?: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <button
        type="button"
        className="btn sm"
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            setError(null)
            const res = await closePeriod(periodId)
            if (res.ok) router.refresh()
            else setError(res.error ?? 'ปิดงวดไม่สำเร็จ')
          })
        }
      >
        {pending ? 'กำลังตรวจสอบ…' : `ปิดงวด ${periodLabel}`}
      </button>
      {error && (
        <div className="alert err" style={{ marginTop: 8, marginBottom: 0 }}>
          <div>
            <strong>ปิดงวดไม่ได้</strong>
            <div>{error}</div>
          </div>
        </div>
      )}
    </>
  )
}
