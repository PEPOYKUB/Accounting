import { q } from '@/lib/db'
import { requireUser, can, ROLE_TH } from '@/lib/auth'
import { saveUser, toggleUser } from '@/lib/master'
import { CrudForm, ToggleButton, Collapsible } from '@/components/CrudPanel'
import NoPermission from '@/components/NoPermission'
import ResetPasswordButton from '@/components/ResetPasswordButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'ผู้ใช้งาน · ระบบบัญชี' }

const ROLE_OPTIONS = [
  { code: 'CONTROLLER', desc: 'ทำได้ทุกอย่าง ปิดงวด จัดการผู้ใช้และผังบัญชี' },
  { code: 'SENIOR_ACCOUNTANT', desc: 'ออกเอกสาร ลงบัญชีมือ กลับรายการ' },
  { code: 'AR_AP_CLERK', desc: 'ออกเอกสารขาย-ซื้อ บันทึกรับ-จ่ายเงิน' },
  { code: 'VIEWER', desc: 'ดูรายงานอย่างเดียว' },
  { code: 'AUDITOR', desc: 'ดูรายงานและบันทึกการแก้ไข' },
] as const

export default async function UsersPage() {
  const me = await requireUser()
  if (!can(me, 'user.manage')) {
    return <NoPermission action="จัดการผู้ใช้งาน" roles={me.roles} allowed={['CONTROLLER']} />
  }

  const rows = await q<{
    id: string; username: string; full_name: string; email: string | null
    is_active: boolean; must_change_password: boolean; last_login_at: string | null
    locked_until: string | null; roles: string[]; sessions: string
  }>(`
    SELECT u.id::text, u.username, u.full_name, u.email, u.is_active,
           u.must_change_password, u.last_login_at::text, u.locked_until::text,
           COALESCE(array_agg(ur.role_code) FILTER (WHERE ur.role_code IS NOT NULL), '{}') AS roles,
           (SELECT COUNT(*) FROM acc.user_sessions s
             WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now())::text AS sessions
      FROM acc.app_users u
      LEFT JOIN acc.user_roles ur ON ur.user_id = u.id
     GROUP BY u.id
     ORDER BY u.id`)

  const enforce = await q<{ value: string }>(
    `SELECT value FROM acc.system_settings WHERE key = 'ENFORCE_MAKER_CHECKER'`
  )
  const makerChecker = enforce[0]?.value === 'true'
  const approvers = rows.filter(
    (r) => r.is_active && (r.roles.includes('CONTROLLER') || r.roles.includes('SENIOR_ACCOUNTANT'))
  ).length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ผู้ใช้งาน</h1>
          <p>ทั้งหมด {rows.length} คน · ผู้ใช้ใหม่จะถูกบังคับให้ตั้งรหัสผ่านเองเมื่อเข้าครั้งแรก</p>
        </div>
      </div>

      {makerChecker && approvers < 2 && (
        <div className="alert warn">
          <div>
            ระบบเปิดกฎ <strong>ผู้อนุมัติต้องไม่ใช่ผู้บันทึก</strong> ไว้ แต่มีผู้มีสิทธิ์อนุมัติเพียง {approvers} คน
            จะบันทึกเอกสารไม่ได้เลย — เพิ่มผู้ใช้ที่มีบทบาทผู้จัดการบัญชีหรือนักบัญชีอาวุโสอีกคน
            หรือปิดกฎนี้ที่หน้า <strong>ตั้งค่ากิจการ</strong>
          </div>
        </div>
      )}

      <Collapsible label="+ เพิ่มผู้ใช้งาน">
        <CrudForm action={saveUser} submitLabel="เพิ่มผู้ใช้">
          <div className="row">
            <div className="field">
              <label>ชื่อผู้ใช้ *</label>
              <input type="text" name="username" required autoCapitalize="none"
                placeholder="a-z 0-9 . _ -" />
            </div>
            <div className="field">
              <label>ชื่อ-นามสกุล *</label>
              <input type="text" name="full_name" required />
            </div>
            <div className="field">
              <label>อีเมล</label>
              <input type="email" name="email" />
            </div>
          </div>
          <div className="field">
            <label>รหัสผ่านเริ่มต้น *</label>
            <input type="password" name="password" required autoComplete="new-password" />
            <div className="hint">อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข · ผู้ใช้ต้องเปลี่ยนเองเมื่อเข้าครั้งแรก</div>
          </div>
          <div className="field">
            <label>บทบาท * (เลือกได้มากกว่าหนึ่ง)</label>
            {ROLE_OPTIONS.map((r) => (
              <label className="check-line" key={r.code}>
                <input type="checkbox" name="roles" value={r.code} />
                <span>
                  <strong>{ROLE_TH[r.code]}</strong>
                  <span className="muted" style={{ fontSize: 12 }}> — {r.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </CrudForm>
      </Collapsible>

      <div className="card">
        <div className="card-head">ผู้ใช้ทั้งหมด</div>
        <div className="table-wrap">
          <table className="tbl cards">
            <thead>
              <tr>
                <th>ชื่อผู้ใช้</th>
                <th>ชื่อ-นามสกุล</th>
                <th>บทบาท</th>
                <th>เข้าล่าสุด</th>
                <th className="num">เซสชัน</th>
                <th>สถานะ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const locked = r.locked_until && new Date(r.locked_until) > new Date()
                return (
                  <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.5 }}>
                    <td data-label="ชื่อผู้ใช้" className="code card-title">
                      {r.username}
                      {r.id === me.id && <span className="badge info" style={{ marginLeft: 6 }}>คุณ</span>}
                    </td>
                    <td data-label="ชื่อ-นามสกุล">{r.full_name}</td>
                    <td data-label="บทบาท">
                      {r.roles.length === 0
                        ? <span className="badge danger">ไม่มีบทบาท</span>
                        : r.roles.map((x) => (
                            <span key={x} className="badge plain" style={{ marginRight: 4 }}>
                              {ROLE_TH[x as keyof typeof ROLE_TH] ?? x}
                            </span>
                          ))}
                    </td>
                    <td data-label="เข้าล่าสุด" className="muted" style={{ fontSize: 12 }}>
                      {r.last_login_at ? new Date(r.last_login_at).toLocaleString('th-TH') : 'ยังไม่เคยเข้า'}
                    </td>
                    <td data-label="เซสชัน" className="num muted">{r.sessions}</td>
                    <td data-label="สถานะ">
                      {locked && <span className="badge danger">ถูกล็อกชั่วคราว</span>}
                      {r.must_change_password && <span className="badge warn">ต้องตั้งรหัสใหม่</span>}
                      {!locked && !r.must_change_password && r.is_active && (
                        <span className="badge ok">ปกติ</span>
                      )}
                      {!r.is_active && <span className="badge plain">ปิดใช้งาน</span>}
                    </td>
                    <td data-label="จัดการ">
                      <div className="toolbar">
                        <ResetPasswordButton userId={r.id} username={r.username} />
                        <ToggleButton id={r.id} active={r.is_active} action={toggleUser} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
