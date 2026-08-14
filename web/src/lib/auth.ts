import 'server-only'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { q, one, pool } from './db'
import { verifyPassword, newSessionToken, hashToken, hashPassword, passwordProblem } from './password'
import { can, ROLE_TH, type AuthUser, type Permission, type Role } from './roles'

export const SESSION_COOKIE = 'acc_session'
const SESSION_DAYS = 7
const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15

// นิยามบทบาทและสิทธิ์อยู่ใน roles.ts เพราะ client component ต้องใช้ด้วย
export { can, ROLE_TH }
export type { Role, AuthUser, Permission }

// =====================================================================
// เซสชัน
// =====================================================================

/** อ่านผู้ใช้จากคุกกี้ — cache ต่อหนึ่ง request เพื่อไม่ให้ query ซ้ำหลายรอบ */
export const getSessionUser = cache(async (): Promise<AuthUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null

  const row = await one<AuthUser & { session_id: string }>(
    `SELECT s.id::text AS session_id, u.id::text, u.username, u.full_name, u.email,
            u.must_change_password,
            COALESCE(array_agg(ur.role_code) FILTER (WHERE ur.role_code IS NOT NULL), '{}') AS roles
       FROM acc.user_sessions s
       JOIN acc.app_users u ON u.id = s.user_id
       LEFT JOIN acc.user_roles ur ON ur.user_id = u.id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.is_active
      GROUP BY s.id, u.id, u.username, u.full_name, u.email, u.must_change_password`,
    [hashToken(token)]
  )

  if (!row) return null

  // อัปเดตเวลาใช้งานล่าสุดแบบไม่บล็อกการเรนเดอร์
  void pool
    .query(`UPDATE acc.user_sessions SET last_seen_at = now() WHERE id = $1::bigint`, [row.session_id])
    .catch(() => {})

  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    email: row.email,
    roles: row.roles as Role[],
    must_change_password: row.must_change_password,
  }
})

/** ใช้ในหน้า/แอ็กชันที่ต้องล็อกอิน — เด้งไปหน้า login ถ้ายังไม่ได้เข้าระบบ */
export async function requireUser(): Promise<AuthUser> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  return user
}

/** ใช้ในแอ็กชันที่ต้องมีสิทธิ์เฉพาะ — โยน error ที่แสดงต่อผู้ใช้ได้ */
export async function requirePermission(perm: Permission): Promise<AuthUser> {
  const user = await requireUser()
  if (!can(user, perm)) {
    throw new Error(
      `บทบาท ${user.roles.map((r) => ROLE_TH[r]).join(', ') || 'ไม่มีบทบาท'} ไม่มีสิทธิ์ดำเนินการนี้`
    )
  }
  return user
}

// =====================================================================
// เข้าสู่ระบบ / ออกจากระบบ
// =====================================================================

type LoginResult = { ok: true } | { ok: false; error: string }

async function clientInfo() {
  const h = await headers()
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0].trim() ?? h.get('x-real-ip') ?? null,
    ua: h.get('user-agent')?.slice(0, 300) ?? null,
  }
}

/**
 * คุกกี้ที่ตั้ง secure จะถูกเบราว์เซอร์ทิ้งทันทีถ้าหน้าเว็บเปิดผ่าน http ธรรมดา
 * ผลคือผู้ใช้ "ล็อกอินผ่าน" แต่พอโหลดหน้าถัดไปกลับเด้งไปหน้าเข้าสู่ระบบอีก
 *
 * จึงต้องดูโปรโตคอลจริงของ request แทนการดู NODE_ENV
 *   - อยู่หลัง reverse proxy / tunnel ที่เป็น HTTPS  -> x-forwarded-proto = https -> secure
 *   - เปิดตรงผ่าน http ในวงแลน                      -> ไม่ secure เพื่อให้ใช้งานได้
 * บังคับค่าเองได้ด้วย SESSION_COOKIE_SECURE = true | false | auto (ค่าเริ่มต้น auto)
 */
async function shouldUseSecureCookie(): Promise<boolean> {
  const mode = (process.env.SESSION_COOKIE_SECURE ?? 'auto').toLowerCase()
  if (mode === 'true') return true
  if (mode === 'false') return false

  const h = await headers()
  const proto = h.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase()
  return proto === 'https'
}

async function logAttempt(username: string, ok: boolean, reason: string | null) {
  const { ip, ua } = await clientInfo()
  await pool
    .query(
      `INSERT INTO acc.login_attempts (username, succeeded, reason, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5)`,
      [username.slice(0, 100), ok, reason, ip, ua]
    )
    .catch(() => {})
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const uname = username.trim().toLowerCase()
  // ข้อความผิดพลาดเหมือนกันทุกกรณี เพื่อไม่ให้เดาได้ว่าชื่อผู้ใช้นี้มีอยู่จริงหรือไม่
  const GENERIC = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'

  if (!uname || !password) return { ok: false, error: GENERIC }

  const u = await one<{
    id: string; password_hash: string; is_active: boolean
    failed_attempts: number; locked_until: string | null
  }>(
    `SELECT id::text, password_hash, is_active, failed_attempts, locked_until::text
       FROM acc.app_users WHERE lower(username) = $1`,
    [uname]
  )

  if (!u || !u.is_active) {
    // เสียเวลาเท่ากับกรณีมีผู้ใช้จริง เพื่อไม่ให้จับเวลาแยกแยะได้
    await verifyPassword(password, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
    await logAttempt(uname, false, u ? 'ผู้ใช้ถูกปิดใช้งาน' : 'ไม่พบผู้ใช้')
    return { ok: false, error: GENERIC }
  }

  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    await logAttempt(uname, false, 'บัญชีถูกล็อกชั่วคราว')
    return {
      ok: false,
      error: `บัญชีถูกล็อกชั่วคราวจากการกรอกรหัสผ่านผิดหลายครั้ง กรุณารออีก ${LOCK_MINUTES} นาที`,
    }
  }

  const valid = await verifyPassword(password, u.password_hash)

  if (!valid) {
    const attempts = u.failed_attempts + 1
    // ต้องระบุชนิดของพารามิเตอร์ให้ชัดทุกตัว มิฉะนั้น PostgreSQL จะเดาชนิดของ $2
    // ไม่ตรงกันระหว่างการกำหนดค่าและการเปรียบเทียบ (text versus smallint)
    await pool.query(
      `UPDATE acc.app_users
          SET failed_attempts = $2::int,
              locked_until = CASE WHEN $2::int >= $3::int
                                  THEN now() + make_interval(mins => $4::int)
                                  ELSE locked_until END
        WHERE id = $1::bigint`,
      [u.id, attempts, MAX_FAILED_ATTEMPTS, LOCK_MINUTES]
    )
    await logAttempt(uname, false, `รหัสผ่านไม่ถูกต้อง (ครั้งที่ ${attempts})`)

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      return { ok: false, error: `กรอกรหัสผ่านผิดครบ ${MAX_FAILED_ATTEMPTS} ครั้ง บัญชีถูกล็อก ${LOCK_MINUTES} นาที` }
    }
    return { ok: false, error: GENERIC }
  }

  // สำเร็จ — ล้างตัวนับ สร้างเซสชันใหม่
  const { token, hash } = newSessionToken()
  const { ip, ua } = await clientInfo()

  await pool.query(
    `UPDATE acc.app_users
        SET failed_attempts = 0, locked_until = NULL, last_login_at = now()
      WHERE id = $1::bigint`,
    [u.id]
  )
  await pool.query(
    `INSERT INTO acc.user_sessions (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1::bigint, $2, now() + make_interval(days => $3::int), $4, $5)`,
    [u.id, hash, SESSION_DAYS, ua, ip]
  )
  await pool.query(`SELECT acc.purge_expired_sessions()`).catch(() => {})
  await logAttempt(uname, true, null)

  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await shouldUseSecureCookie(),
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })

  return { ok: true }
}

export async function logout(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) {
    await pool
      .query(`UPDATE acc.user_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [
        hashToken(token),
      ])
      .catch(() => {})
  }
  store.delete(SESSION_COOKIE)
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<LoginResult> {
  const user = await requireUser()

  const row = await one<{ password_hash: string }>(
    `SELECT password_hash FROM acc.app_users WHERE id = $1::bigint`,
    [user.id]
  )
  if (!(await verifyPassword(currentPassword, row?.password_hash ?? null))) {
    return { ok: false, error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' }
  }

  const problem = passwordProblem(newPassword)
  if (problem) return { ok: false, error: problem }
  if (await verifyPassword(newPassword, row?.password_hash ?? null)) {
    return { ok: false, error: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม' }
  }

  const hash = await hashPassword(newPassword)
  await pool.query(
    `UPDATE acc.app_users
        SET password_hash = $2, must_change_password = FALSE, password_changed_at = now()
      WHERE id = $1::bigint`,
    [user.id, hash]
  )

  // ถอนเซสชันอื่นทั้งหมด เหลือเฉพาะเครื่องที่กำลังใช้อยู่
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  await pool.query(
    `UPDATE acc.user_sessions SET revoked_at = now()
      WHERE user_id = $1::bigint AND revoked_at IS NULL AND token_hash <> $2`,
    [user.id, token ? hashToken(token) : '']
  )

  return { ok: true }
}

/** เซสชันที่ยังใช้งานได้ของผู้ใช้ปัจจุบัน */
export async function listMySessions(userId: string) {
  return q<{
    id: string; created_at: string; last_seen_at: string; expires_at: string
    user_agent: string | null; ip_address: string | null
  }>(
    `SELECT id::text, created_at::text, last_seen_at::text, expires_at::text, user_agent, ip_address
       FROM acc.user_sessions
      WHERE user_id = $1::bigint AND revoked_at IS NULL AND expires_at > now()
      ORDER BY last_seen_at DESC`,
    [userId]
  )
}
