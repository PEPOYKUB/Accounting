'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reverseEntry } from '@/lib/posting'

export default function ReverseButton({ entryId, entryNo }: { entryId: string; entryNo: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button type="button" className="btn danger sm" onClick={() => setOpen(true)}>
        กลับรายการ
      </button>
    )
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-body">
        <div className="alert warn">
          <div>
            รายการที่ลงบัญชีแล้วแก้ไขไม่ได้ตามหลักการตรวจสอบย้อนกลับ — ระบบจะสร้าง
            <strong>ใบกลับรายการใบใหม่</strong>ที่สลับด้านเดบิตกับเครดิตทุกบรรทัดแทน
            ถ้างวดเดิมปิดแล้ว ใบกลับรายการจะลงในงวดที่เปิดอยู่ถัดไป
          </div>
        </div>
        {error && <div className="alert err"><div>{error}</div></div>}
        <div className="field">
          <label>เหตุผลในการกลับรายการ</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`เช่น บันทึกผิดบัญชีในใบ ${entryNo}`}
          />
        </div>
        <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => setOpen(false)} disabled={pending}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={pending || !reason.trim()}
            onClick={() =>
              start(async () => {
                setError(null)
                const res = await reverseEntry(entryId, reason.trim())
                if (res.ok) router.push(`/journal?created=${encodeURIComponent(res.docNo)}`)
                else setError(res.error)
              })
            }
          >
            {pending ? 'กำลังสร้างใบกลับรายการ…' : 'ยืนยันกลับรายการ'}
          </button>
        </div>
      </div>
    </div>
  )
}
