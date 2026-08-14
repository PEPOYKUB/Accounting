import { NextResponse } from 'next/server'
import { q, one } from '@/lib/db'
import { runSync } from '@/lib/exporting'

export const dynamic = 'force-dynamic'

/**
 * ให้งานตั้งเวลาภายนอกเรียกซิงก์เข้า Google Sheets
 *
 *   curl -X POST "http://<host>:3100/api/export/sync" -H "X-Export-Token: <token>"
 *
 * โทเคนดูได้ที่หน้า ตั้งค่า → ส่งข้อมูลให้นักบัญชี
 * เส้นทางนี้ไม่ใช้เซสชันผู้ใช้ จึงต้องมีโทเคนเสมอ
 */
export async function POST(request: Request) {
  const token = request.headers.get('x-export-token') ?? ''
  const expected = await one<{ value: string }>(
    `SELECT value FROM acc.system_settings WHERE key = 'EXPORT_CRON_TOKEN'`
  )

  if (!expected?.value || token.length !== expected.value.length || token !== expected.value) {
    return NextResponse.json({ ok: false, error: 'โทเคนไม่ถูกต้อง' }, { status: 401 })
  }

  const targets = await q<{ id: string; name: string }>(
    `SELECT id::text, name FROM acc.export_targets WHERE is_enabled ORDER BY id`
  )
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, message: 'ไม่มีปลายทางที่เปิดใช้งาน', results: [] })
  }

  const results = []
  for (const t of targets) {
    const r = await runSync(t.id, 'cron')
    results.push({ target: t.name, ...r })
  }

  const allOk = results.every((r) => r.ok)
  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 500 })
}
