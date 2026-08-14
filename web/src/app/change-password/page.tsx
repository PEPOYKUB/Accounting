import { requireUser } from '@/lib/auth'
import ChangePasswordForm from '@/components/ChangePasswordForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'เปลี่ยนรหัสผ่าน · ระบบบัญชี' }

export default async function ChangePasswordPage() {
  const user = await requireUser()

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">฿</div>
          <div>
            <h1>{user.must_change_password ? 'ตั้งรหัสผ่านใหม่' : 'เปลี่ยนรหัสผ่าน'}</h1>
            <p>{user.full_name} ({user.username})</p>
          </div>
        </div>

        {user.must_change_password && (
          <div className="alert warn">
            <div>
              นี่คือการเข้าใช้งานครั้งแรก ต้องตั้งรหัสผ่านใหม่ก่อนจึงจะใช้งานระบบได้
            </div>
          </div>
        )}

        <ChangePasswordForm forced={user.must_change_password} />
      </div>
    </div>
  )
}
