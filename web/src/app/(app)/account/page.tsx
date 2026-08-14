import Link from 'next/link'
import { requireUser, listMySessions, ROLE_TH, can } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { thaiDate } from '@/lib/money'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'บัญชีของฉัน · ระบบบัญชี' }

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'เมื่อครู่นี้'
  if (m < 60) return `${m} นาทีที่แล้ว`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`
  return `${Math.floor(h / 24)} วันที่แล้ว`
}

export default async function AccountPage() {
  const user = await requireUser()
  const sessions = await listMySessions(user.id)

  const profile = await one<{ last_login_at: string | null; password_changed_at: string | null }>(
    `SELECT last_login_at::text, password_changed_at::text FROM acc.app_users WHERE id = $1::bigint`,
    [user.id]
  )

  const attempts = await q<{ succeeded: boolean; reason: string | null; ip_address: string | null; attempted_at: string }>(
    `SELECT succeeded, reason, ip_address, attempted_at::text
       FROM acc.login_attempts
      WHERE lower(username) = lower($1)
      ORDER BY attempted_at DESC LIMIT 10`,
    [user.username]
  )

  const PERMS: { key: Parameters<typeof can>[1]; label: string }[] = [
    { key: 'doc.create', label: 'ออกเอกสารขาย-ซื้อ และบันทึกรับ-จ่ายเงิน' },
    { key: 'journal.create', label: 'ลงบัญชีมือ' },
    { key: 'journal.reverse', label: 'กลับรายการที่ลงบัญชีแล้ว' },
    { key: 'period.close', label: 'ปิดงวดบัญชี' },
    { key: 'coa.manage', label: 'แก้ไขผังบัญชี' },
    { key: 'user.manage', label: 'จัดการผู้ใช้งาน' },
    { key: 'audit.view', label: 'ดูบันทึกการแก้ไข (Audit Log)' },
    { key: 'report.view', label: 'ดูรายงานทั้งหมด' },
  ]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>บัญชีของฉัน</h1>
          <p>{user.full_name} · @{user.username}</p>
        </div>
        <Link className="btn" href="/change-password">เปลี่ยนรหัสผ่าน</Link>
      </div>

      <div className="grid c2">
        <div className="card">
          <div className="card-head">ข้อมูลบัญชี</div>
          <div className="table-wrap">
            <table className="tbl cards">
              <tbody>
                <tr><td>ชื่อ-นามสกุล</td><td>{user.full_name}</td></tr>
                <tr><td>ชื่อผู้ใช้</td><td className="code">{user.username}</td></tr>
                <tr><td>อีเมล</td><td>{user.email ?? '—'}</td></tr>
                <tr>
                  <td>บทบาท</td>
                  <td>
                    {user.roles.length === 0
                      ? <span className="muted">ไม่มีบทบาท</span>
                      : user.roles.map((r) => (
                          <span key={r} className="badge info" style={{ marginRight: 4 }}>{ROLE_TH[r]}</span>
                        ))}
                  </td>
                </tr>
                <tr>
                  <td>เข้าสู่ระบบล่าสุด</td>
                  <td>{profile?.last_login_at ? new Date(profile.last_login_at).toLocaleString('th-TH') : '—'}</td>
                </tr>
                <tr>
                  <td>เปลี่ยนรหัสผ่านล่าสุด</td>
                  <td>
                    {profile?.password_changed_at
                      ? thaiDate(profile.password_changed_at.slice(0, 10))
                      : <span className="badge warn">ยังไม่เคยเปลี่ยน</span>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">สิทธิ์ที่ได้รับ</div>
          <div className="table-wrap">
            <table className="tbl cards">
              <tbody>
                {PERMS.map((p) => (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    <td style={{ width: 90, textAlign: 'right' }}>
                      {can(user, p.key)
                        ? <span className="badge ok">มีสิทธิ์</span>
                        : <span className="badge plain">ไม่มีสิทธิ์</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          อุปกรณ์ที่เข้าสู่ระบบอยู่
          <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
            เปลี่ยนรหัสผ่านเพื่อออกจากระบบทุกเครื่องพร้อมกัน
          </span>
        </div>
        <div className="table-wrap">
          <table className="tbl cards">
            <thead>
              <tr>
                <th>เข้าสู่ระบบเมื่อ</th>
                <th>ใช้งานล่าสุด</th>
                <th>หมดอายุ</th>
                <th>หมายเลข IP</th>
                <th>อุปกรณ์</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td data-label="เข้าสู่ระบบเมื่อ" className="nowrap">{new Date(s.created_at).toLocaleString('th-TH')}</td>
                  <td data-label="ใช้งานล่าสุด" className="nowrap">{timeAgo(s.last_seen_at)}</td>
                  <td data-label="หมดอายุ" className="nowrap">{thaiDate(s.expires_at.slice(0, 10))}</td>
                  <td data-label="หมายเลข IP" className="code">{s.ip_address ?? '—'}</td>
                  <td data-label="อุปกรณ์" className="muted" style={{ fontSize: 11.5, maxWidth: 320 }}>{s.user_agent ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">ประวัติการเข้าสู่ระบบล่าสุด</div>
        <div className="table-wrap">
          <table className="tbl cards">
            <thead>
              <tr><th>เวลา</th><th>ผล</th><th>รายละเอียด</th><th>หมายเลข IP</th></tr>
            </thead>
            <tbody>
              {attempts.map((a, i) => (
                <tr key={i}>
                  <td data-label="เวลา" className="nowrap">{new Date(a.attempted_at).toLocaleString('th-TH')}</td>
                  <td data-label="ผล">
                    <span className={`badge ${a.succeeded ? 'ok' : 'danger'}`}>
                      {a.succeeded ? 'สำเร็จ' : 'ไม่สำเร็จ'}
                    </span>
                  </td>
                  <td data-label="รายละเอียด" className="muted">{a.reason ?? '—'}</td>
                  <td data-label="หมายเลข IP" className="code">{a.ip_address ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
