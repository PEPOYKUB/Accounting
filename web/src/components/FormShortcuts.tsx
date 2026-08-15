'use client'

/*
  คีย์ลัดระดับหน้าจอสำหรับฟอร์มบันทึกเอกสาร

  Ctrl/Cmd + Enter  บันทึก
  Alt + N           เพิ่มบรรทัดใหม่

  ตั้งใจใช้ Alt + N แทน Ctrl + N เพราะ Ctrl + N เป็นคีย์เปิดหน้าต่างใหม่ของเบราว์เซอร์
  และไม่ผูก Esc ไว้กับการยกเลิก เพราะฟอร์มบัญชีที่คีย์มาครึ่งใบแล้วหายเพราะเผลอกด Esc
  สร้างความเสียหายมากกว่าความสะดวกที่ได้
*/

import { useEffect } from 'react'

export default function FormShortcuts({
  onSave,
  onAddLine,
  disabled,
}: {
  onSave?: () => void
  onAddLine?: () => void
  disabled?: boolean
}) {
  useEffect(() => {
    if (disabled) return

    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        onSave?.()
        return
      }
      if (e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        onAddLine?.()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSave, onAddLine, disabled])

  return null
}
