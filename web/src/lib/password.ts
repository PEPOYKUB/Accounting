import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>

// พารามิเตอร์ scrypt ตามคำแนะนำของ OWASP (N=2^15, r=8, p=1)
const N = 32768
const R = 8
const P = 1
const KEYLEN = 32

// ค่าเริ่มต้นของ Node จำกัดหน่วยความจำไว้ 32MB ซึ่งพอดีเป๊ะกับ N=2^15,r=8 (128·N·r)
// จึงต้องเผื่อไว้ให้มากกว่านั้น มิฉะนั้นจะได้ ERR_CRYPTO_INVALID_SCRYPT_PARAMS
const MAXMEM = 96 * 1024 * 1024

/** รูปแบบที่เก็บ: scrypt$N$r$p$saltBase64$hashBase64 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(plain.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$')
}

/**
 * ตรวจรหัสผ่านแบบ constant-time
 * คืน false เสมอเมื่อรูปแบบ hash ผิด ไม่โยน error เพื่อไม่ให้ผู้โจมตีแยกแยะสาเหตุได้
 */
export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, nStr, rStr, pStr, saltB64, hashB64] = parts
  const n = Number(nStr)
  const r = Number(rStr)
  const p = Number(pStr)
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false

  try {
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(hashB64, 'base64')
    const actual = await scrypt(plain.normalize('NFKC'), salt, expected.length, { N: n, r, p, maxmem: MAXMEM })
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/** โทเคนเซสชันแบบสุ่ม — เก็บลงฐานข้อมูลเฉพาะค่าแฮช ไม่เก็บตัวโทเคนเอง */
export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** ตรวจความแข็งแรงขั้นต่ำของรหัสผ่าน */
export function passwordProblem(plain: string): string | null {
  if (plain.length < 8) return 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'
  if (!/[A-Za-z]/.test(plain)) return 'รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว'
  if (!/[0-9]/.test(plain)) return 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว'
  return null
}
