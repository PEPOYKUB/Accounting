import Link from 'next/link'
import { setupChecklist } from '@/lib/master'

/**
 * แถบแนะนำขั้นตอนตั้งค่าบนแดชบอร์ด
 * แสดงเฉพาะตอนที่ยังตั้งค่าไม่ครบ พอครบแล้วจะหายไปเอง
 */
export default async function SetupChecklist({ canManage }: { canManage: boolean }) {
  const c = await setupChecklist()
  if (!c) return null

  const steps = [
    { ok: c.company > 0, label: 'กรอกข้อมูลกิจการ', href: '/settings/company', need: canManage },
    { ok: c.periods > 0, label: 'สร้างงวดบัญชี', href: '/periods', need: canManage },
    { ok: c.banks > 0, label: 'เพิ่มบัญชีธนาคาร', href: '/settings/banks', need: canManage },
    { ok: c.customers > 0, label: 'เพิ่มลูกค้า', href: '/settings/partners', need: true },
    { ok: c.vendors > 0, label: 'เพิ่มผู้ขาย', href: '/settings/partners', need: true },
  ]

  const remaining = steps.filter((s) => !s.ok)
  if (remaining.length === 0) return null

  return (
    <div className="card setup-banner" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <span>เริ่มต้นใช้งาน — ยังเหลืออีก {remaining.length} ขั้นตอน</span>
        <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
          {c.entries > 0 ? `บันทึกไปแล้ว ${c.entries} รายการ` : 'ยังไม่มีรายการบัญชี'}
        </span>
      </div>
      <div className="card-body">
        <div className="setup-steps">
          {steps.map((s) => (
            <div key={s.label} className={`setup-step${s.ok ? ' done' : ''}`}>
              <span className="mark">{s.ok ? '✓' : '○'}</span>
              <span className="txt">{s.label}</span>
              {!s.ok && s.need && (
                <Link className="btn sm" href={s.href}>ตั้งค่า</Link>
              )}
              {!s.ok && !s.need && <span className="muted" style={{ fontSize: 12 }}>รอผู้ดูแล</span>}
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
          เมื่อครบทุกข้อแล้วจึงจะออกใบแจ้งหนี้และบันทึกรับ-จ่ายเงินได้ ·
          ยอดยกมาตั้งต้นบันทึกผ่านเมนู <strong>ลงบัญชีมือ</strong> โดยเลือกประเภทรายการเป็น “ยอดยกมา”
        </p>
      </div>
    </div>
  )
}
