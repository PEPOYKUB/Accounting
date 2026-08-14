import 'server-only'
import { createSign } from 'node:crypto'

/**
 * เชื่อม Google Sheets ด้วย Service Account โดยตรงผ่าน REST API
 * ไม่ใช้แพ็กเกจ googleapis เพราะต้องการแค่ 3 endpoint และอยากให้ตรวจสอบโค้ดได้ง่าย
 *
 * ขั้นตอนฝั่ง Google ที่ลูกค้าต้องทำครั้งเดียว
 *   1. สร้างโปรเจกต์ใน Google Cloud Console (ฟรี)
 *   2. เปิดใช้งาน Google Sheets API
 *   3. สร้าง Service Account แล้วสร้าง key แบบ JSON
 *   4. เปิด Google Sheet ที่ต้องการ กด "แชร์" ให้อีเมลของ Service Account เป็น "ผู้แก้ไข"
 */

export type ServiceAccount = {
  client_email: string
  private_key: string
}

export type SheetTab = {
  name: string
  headers: string[]
  rows: (string | number | null)[][]
  /** แถวข้อมูลกำกับด้านบน เช่น ชื่อกิจการและช่วงเวลา */
  caption?: string[]
}

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://sheets.googleapis.com/v4/spreadsheets'

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** แลก Service Account เป็น access token อายุ 1 ชั่วโมง */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))

  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  // key ที่คัดลอกมาจาก JSON มักมี \n เป็นตัวอักษรสองตัว ต้องแปลงกลับเป็นขึ้นบรรทัดจริง
  const key = sa.private_key.includes('\\n') ? sa.private_key.replace(/\\n/g, '\n') : sa.private_key
  const signature = b64url(signer.sign(key))

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${signature}`,
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      `ขอสิทธิ์จาก Google ไม่สำเร็จ (${res.status}): ` +
      (data.error_description || data.error || 'ตรวจว่า private key ถูกต้องและเปิดใช้ Google Sheets API แล้ว')
    )
  }
  return data.access_token as string
}

async function call(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error?.message ?? `HTTP ${res.status}`
    if (res.status === 403) {
      throw new Error(
        `Google ปฏิเสธการเข้าถึง — ตรวจว่าได้แชร์ Google Sheet ให้อีเมลของ Service Account ` +
        `เป็นสิทธิ์ "ผู้แก้ไข" แล้วหรือยัง (${msg})`
      )
    }
    if (res.status === 404) {
      throw new Error(`ไม่พบ Google Sheet ตามรหัสที่ระบุ — ตรวจ Spreadsheet ID อีกครั้ง (${msg})`)
    }
    throw new Error(`Google Sheets API ผิดพลาด: ${msg}`)
  }
  return data
}

/** ตรวจว่าเชื่อมต่อได้จริงและมีสิทธิ์เขียน */
export async function testConnection(sa: ServiceAccount, spreadsheetId: string) {
  const token = await getAccessToken(sa)
  const info = await call(token, `/${spreadsheetId}?fields=properties.title,sheets.properties`)
  return {
    title: info?.properties?.title as string,
    tabs: (info?.sheets ?? []).map((s: { properties: { title: string } }) => s.properties.title) as string[],
  }
}

/**
 * เขียนข้อมูลลง Google Sheet
 * แต่ละแท็บถูกล้างแล้วเขียนใหม่ทั้งแผ่น เพื่อให้ตัวเลขตรงกับระบบเสมอ ไม่มีของค้างจากรอบก่อน
 */
export async function syncToSheet(
  sa: ServiceAccount,
  spreadsheetId: string,
  tabs: SheetTab[]
): Promise<{ written: number; tabs: string[] }> {
  const token = await getAccessToken(sa)

  // 1) ดูว่ามีแท็บอะไรอยู่แล้วบ้าง
  const info = await call(token, `/${spreadsheetId}?fields=sheets.properties`)
  const existing = new Map<string, number>()
  for (const s of info?.sheets ?? []) {
    existing.set(s.properties.title, s.properties.sheetId)
  }

  // 2) สร้างแท็บที่ยังไม่มี
  const toCreate = tabs.filter((t) => !existing.has(t.name))
  if (toCreate.length > 0) {
    await call(token, `/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: toCreate.map((t) => ({ addSheet: { properties: { title: t.name } } })),
      }),
    })
  }

  // 3) ล้างข้อมูลเดิมของทุกแท็บที่จะเขียน
  await call(token, `/${spreadsheetId}/values:batchClear`, {
    method: 'POST',
    body: JSON.stringify({ ranges: tabs.map((t) => `'${t.name.replace(/'/g, "''")}'`) }),
  })

  // 4) เขียนข้อมูลใหม่ทั้งหมดในครั้งเดียว
  const data = tabs.map((t) => {
    const values: (string | number | null)[][] = []
    if (t.caption) values.push(t.caption)
    values.push(t.headers)
    values.push(...t.rows)
    return { range: `'${t.name.replace(/'/g, "''")}'!A1`, values }
  })

  await call(token, `/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  })

  // 5) ตรึงแถวหัวตารางให้เลื่อนดูง่าย
  const freezeRequests = tabs
    .map((t) => {
      const sheetId = existing.get(t.name)
      if (sheetId === undefined) return null
      return {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: t.caption ? 2 : 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      }
    })
    .filter(Boolean)

  if (freezeRequests.length > 0) {
    await call(token, `/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: freezeRequests }),
    }).catch(() => {
      // ตรึงแถวไม่สำเร็จไม่ใช่เรื่องคอขาดบาดตาย ข้อมูลเขียนไปแล้ว
    })
  }

  return {
    written: tabs.reduce((a, t) => a + t.rows.length, 0),
    tabs: tabs.map((t) => t.name),
  }
}

/** แปลงข้อความ JSON ของ Service Account เป็นออบเจ็กต์ พร้อมตรวจความถูกต้อง */
export function parseServiceAccount(json: string): ServiceAccount {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(json)
  } catch {
    throw new Error('ไฟล์ Service Account ไม่ใช่ JSON ที่ถูกต้อง — คัดลอกทั้งไฟล์รวมวงเล็บปีกกาด้วย')
  }
  const email = obj.client_email
  const key = obj.private_key
  if (typeof email !== 'string' || typeof key !== 'string') {
    throw new Error('ไม่พบ client_email หรือ private_key ในไฟล์ — ต้องเป็นคีย์แบบ JSON ของ Service Account')
  }
  if (!key.includes('PRIVATE KEY')) {
    throw new Error('private_key ในไฟล์ดูไม่ถูกต้อง')
  }
  return { client_email: email, private_key: key }
}
