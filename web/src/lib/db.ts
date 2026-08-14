import { Pool, types, type PoolClient } from 'pg'

// ---------------------------------------------------------------------
// สำคัญที่สุดของไฟล์นี้: ห้ามให้ไดรเวอร์แปลง NUMERIC เป็น float เด็ดขาด
// pg แปลง numeric เป็น string อยู่แล้วโดยปริยาย แต่ประกาศไว้ชัด ๆ กันพลาด
// ---------------------------------------------------------------------
types.setTypeParser(1700, (v) => v) // numeric  -> string
types.setTypeParser(1082, (v) => v) // date     -> 'YYYY-MM-DD' ไม่แปลงเป็น Date object
types.setTypeParser(20, (v) => v)   // int8     -> string (กัน overflow)

const globalForPg = globalThis as unknown as { _accPool?: Pool }

export const pool =
  globalForPg._accPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  })

if (!globalForPg._accPool) globalForPg._accPool = pool

/** คิวรีแบบอ่านอย่างเดียว */
export async function q<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await pool.query(sql, params)
  return res.rows as T[]
}

/** คิวรีที่คาดว่าได้แถวเดียว */
export async function one<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await q<T>(sql, params)
  return rows[0] ?? null
}

/**
 * รันงานทั้งชุดในทรานแซกชันเดียว
 * ทุกการลงบัญชีต้องผ่านฟังก์ชันนี้ เพราะฐานข้อมูลตรวจสมดุลตอน COMMIT
 * และตั้งค่า app.current_user ให้ audit log บันทึกว่าใครเป็นคนทำ
 */
export async function tx<T>(
  actor: string,
  fn: (c: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user', actor])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * แปลง error จากฐานข้อมูลเป็นข้อความภาษาไทยที่ผู้ใช้เข้าใจได้
 * ข้อความจาก trigger เราเขียนเป็นภาษาไทยอยู่แล้ว จึงส่งต่อตรง ๆ ได้
 */
export function dbErrorMessage(err: unknown): string {
  const e = err as { message?: string; code?: string; constraint?: string }
  const raw = e?.message ?? 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'

  const byConstraint: Record<string, string> = {
    jel_one_side_only: 'แต่ละบรรทัดต้องเป็นเดบิตหรือเครดิตอย่างใดอย่างหนึ่ง และต้องมากกว่าศูนย์',
    inv_total_consistent: 'ยอดรวมในเอกสารไม่ตรงกับผลรวมของบรรทัด',
    bill_total_consistent: 'ยอดรวมในใบตั้งหนี้ไม่ตรงกับผลรวมของบรรทัด',
    rc_net_consistent: 'ยอดเงินรับสุทธิไม่ตรงกับยอดรวมหักภาษี ณ ที่จ่ายและค่าธรรมเนียม',
    pay_net_consistent: 'ยอดจ่ายสุทธิไม่ตรงกับยอดรวมหักภาษี ณ ที่จ่าย',
    journal_entries_entry_no_key: 'เลขที่ใบสำคัญนี้ถูกใช้ไปแล้ว',
    inv_paid_not_over: 'ยอดรับชำระรวมเกินยอดในใบแจ้งหนี้',
  }

  if (e?.constraint && byConstraint[e.constraint]) return byConstraint[e.constraint]

  // ตัด prefix ทางเทคนิคของ PostgreSQL ออก เหลือเฉพาะข้อความที่เราเขียนไว้เอง
  return raw.replace(/^error:\s*/i, '')
}

/**
 * Next.js ใช้ข้อยกเว้นในการสั่ง redirect และ notFound
 * ถ้า catch แล้วกลืนไว้ การเปลี่ยนหน้าจะไม่เกิดขึ้น จึงต้องโยนต่อเสมอ
 */
export function isFrameworkError(err: unknown): boolean {
  const digest = (err as { digest?: unknown })?.digest
  return typeof digest === 'string' && digest.startsWith('NEXT_')
}
