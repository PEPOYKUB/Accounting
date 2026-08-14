// โมดูลนี้ต้องไม่มีโค้ดฝั่งเซิร์ฟเวอร์ เพราะ client component เรียกใช้ด้วย

export type Role = 'CONTROLLER' | 'SENIOR_ACCOUNTANT' | 'AR_AP_CLERK' | 'VIEWER' | 'AUDITOR'

export type AuthUser = {
  id: string
  username: string
  full_name: string
  email: string | null
  roles: Role[]
  must_change_password: boolean
}

export type Permission =
  | 'doc.create'      // ออกเอกสารขาย-ซื้อ บันทึกรับ-จ่ายเงิน
  | 'journal.create'  // ลงบัญชีมือ
  | 'journal.reverse' // กลับรายการ
  | 'period.close'    // ปิดงวด
  | 'coa.manage'      // แก้ผังบัญชี
  | 'user.manage'     // จัดการผู้ใช้
  | 'audit.view'      // ดูบันทึกการแก้ไข
  | 'report.view'     // ดูรายงาน

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  CONTROLLER: [
    'doc.create', 'journal.create', 'journal.reverse',
    'period.close', 'coa.manage', 'user.manage', 'audit.view', 'report.view',
  ],
  SENIOR_ACCOUNTANT: ['doc.create', 'journal.create', 'journal.reverse', 'report.view'],
  AR_AP_CLERK: ['doc.create', 'report.view'],
  VIEWER: ['report.view'],
  AUDITOR: ['report.view', 'audit.view'],
}

export const ROLE_TH: Record<Role, string> = {
  CONTROLLER: 'ผู้จัดการบัญชี',
  SENIOR_ACCOUNTANT: 'นักบัญชีอาวุโส',
  AR_AP_CLERK: 'นักบัญชี AR/AP',
  VIEWER: 'ผู้บริหาร (ดูอย่างเดียว)',
  AUDITOR: 'ผู้สอบบัญชี',
}

export function can(user: AuthUser | null, perm: Permission): boolean {
  if (!user) return false
  return user.roles.some((r) => ROLE_PERMISSIONS[r]?.includes(perm))
}
