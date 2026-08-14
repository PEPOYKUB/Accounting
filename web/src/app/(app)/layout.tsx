import { redirect } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/AppShell'
import { requireUser, can } from '@/lib/auth'
import { one } from '@/lib/db'

export const dynamic = 'force-dynamic'

async function HealthBadge() {
  try {
    const eq = await one<{ out_of_balance: string }>(
      `SELECT out_of_balance FROM acc.v_accounting_equation_check`
    )
    const ctl = await one<{ worst: string }>(
      `SELECT COALESCE(MAX(ABS(difference)),0)::text AS worst FROM acc.v_control_reconciliation`
    )
    const ok = Number(eq?.out_of_balance ?? 0) === 0 && Number(ctl?.worst ?? 0) === 0

    return ok ? (
      <span className="badge ok" title="สมการบัญชีสมดุล และบัญชีคุมตรงกับบัญชีย่อย">
        ● ระบบสมดุล
      </span>
    ) : (
      <Link href="/" className="badge danger" title="ตรวจพบความไม่สมดุล ดูรายละเอียดที่แดชบอร์ด">
        ● ตรวจพบความผิดปกติ
      </Link>
    )
  } catch {
    return <span className="badge warn">● เชื่อมต่อฐานข้อมูลไม่ได้</span>
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  // บังคับเปลี่ยนรหัสผ่านครั้งแรกก่อนใช้งานส่วนอื่น
  if (user.must_change_password) redirect('/change-password')

  return (
    <AppShell
      user={user}
      perms={{
        canCreateDoc: can(user, 'doc.create'),
        canJournal: can(user, 'journal.create'),
        canClosePeriod: can(user, 'period.close'),
        canManageMaster: can(user, 'coa.manage'),
        canManageUsers: can(user, 'user.manage'),
      }}
      health={<HealthBadge />}
    >
      {children}
    </AppShell>
  )
}
