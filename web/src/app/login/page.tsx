import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { q } from '@/lib/db'
import { isFirstRun } from '@/lib/master'
import LoginForm from '@/components/LoginForm'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'เข้าสู่ระบบ · ระบบบัญชี' }

export default async function LoginPage() {
  // ฐานข้อมูลเปล่ายังไม่มีผู้ใช้ ต้องพาไปหน้าติดตั้งก่อน มิฉะนั้นจะล็อกอินไม่ได้เลย
  if (await isFirstRun()) redirect('/setup')

  const user = await getSessionUser()
  if (user) redirect('/')

  const demoMode = process.env.DEMO_MODE === 'true'

  // แสดงรายชื่อบัญชีทดลองเฉพาะเมื่อเปิดโหมดสาธิตเท่านั้น
  const demoUsers = demoMode
    ? await q<{ username: string; full_name: string; roles: string[] }>(
        `SELECT u.username, u.full_name,
                COALESCE(array_agg(r.name_th ORDER BY r.name_th)
                         FILTER (WHERE r.name_th IS NOT NULL), '{}') AS roles
           FROM acc.app_users u
           LEFT JOIN acc.user_roles ur ON ur.user_id = u.id
           LEFT JOIN acc.roles r ON r.code = ur.role_code
          WHERE u.is_active
          GROUP BY u.id, u.username, u.full_name
          ORDER BY u.id`
      ).catch(() => [])
    : []

  return <LoginForm demoMode={demoMode} demoUsers={demoUsers} />
}
