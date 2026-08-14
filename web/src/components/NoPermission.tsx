import Link from 'next/link'
import { ROLE_TH, type Role } from '@/lib/roles'

export default function NoPermission({
  action,
  roles,
  allowed,
}: {
  action: string
  roles: Role[]
  allowed: Role[]
}) {
  return (
    <>
      <div className="page-head">
        <div><h1>ไม่มีสิทธิ์เข้าถึง</h1></div>
      </div>
      <div className="alert warn">
        <div>
          <strong>บทบาทของคุณไม่มีสิทธิ์{action}</strong>
          <div style={{ marginTop: 6 }}>
            บทบาทปัจจุบัน: {roles.map((r) => ROLE_TH[r]).join(', ') || 'ไม่มีบทบาท'}
            <br />
            บทบาทที่ทำรายการนี้ได้: {allowed.map((r) => ROLE_TH[r]).join(', ')}
          </div>
          <div style={{ marginTop: 10 }}>
            <Link className="btn" href="/">← กลับหน้าแดชบอร์ด</Link>
          </div>
        </div>
      </div>
    </>
  )
}
