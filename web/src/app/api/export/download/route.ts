import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { requireUser, can } from '@/lib/auth'
import { buildReports } from '@/lib/reports'

export const dynamic = 'force-dynamic'

/**
 * ดาวน์โหลดรายงานสำหรับสำนักงานบัญชี
 *   /api/export/download?format=xlsx           ทุกแท็บในไฟล์เดียว
 *   /api/export/download?format=csv&key=journal  แท็บเดียวเป็น CSV
 *   เพิ่ม &period=<id> เพื่อจำกัดงวด และ &year=1 เพื่อเอาทั้งปีบัญชี
 */
export async function GET(request: Request) {
  const user = await requireUser()
  if (!can(user, 'report.view')) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์ดูรายงาน' }, { status: 403 })
  }

  const url = new URL(request.url)
  const format = url.searchParams.get('format') ?? 'xlsx'
  const key = url.searchParams.get('key')
  const periodId = url.searchParams.get('period') ?? undefined
  const wholeYear = url.searchParams.get('year') === '1'

  const { reports, range, company, generatedAt } = await buildReports({ periodId, wholeYear })
  const stamp = new Date().toISOString().slice(0, 10)
  // ต้องอนุญาต \p{M} ด้วย มิฉะนั้นสระและวรรณยุกต์ไทยจะถูกตัดทิ้ง
  // เช่น "กิจการ" จะกลายเป็น "กจการ" เพราะสระอิเป็น combining mark ไม่ใช่ตัวอักษร
  const safeCompany = company.replace(/[^\p{L}\p{M}\p{N} _-]/gu, '').slice(0, 40) || 'บัญชี'

  // ── CSV แท็บเดียว ────────────────────────────────────────────────
  if (format === 'csv') {
    const report = reports.find((r) => r.key === key)
    if (!report) {
      return NextResponse.json({ error: 'ไม่พบรายงานที่ระบุ' }, { status: 404 })
    }

    const esc = (v: string | number | null) => {
      const t = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
    }
    const lines = [
      esc(`${company} · ${report.title} · ${range.label} · ข้อมูล ณ ${generatedAt}`),
      report.headers.map(esc).join(','),
      ...report.rows.map((row) => row.map(esc).join(',')),
    ]
    // BOM จำเป็นมาก ไม่งั้น Excel เปิดภาษาไทยเป็นตัวยึกยือ
    const body = '﻿' + lines.join('\r\n')

    return new NextResponse(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${safeCompany}-${report.key}-${stamp}.csv`)}`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // ── Excel ทุกแท็บในไฟล์เดียว ─────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  wb.creator = company
  wb.created = new Date()

  for (const r of reports) {
    // ชื่อแท็บใน Excel ห้ามเกิน 31 ตัว และห้ามมี : \ / ? * [ ]
    const tabName = r.sheetName.replace(/[:\\/?*[\]]/g, '-').slice(0, 31)
    const ws = wb.addWorksheet(tabName, { views: [{ state: 'frozen', ySplit: 2 }] })

    const caption = ws.addRow([`${company} · ${r.title} · ${range.label} · ข้อมูล ณ ${generatedAt}`])
    caption.font = { bold: true, size: 11 }
    ws.mergeCells(1, 1, 1, Math.max(r.headers.length, 1))

    const head = ws.addRow(r.headers)
    head.font = { bold: true }
    head.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2F5' } }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFBFC7CF' } } }
    })

    for (const row of r.rows) ws.addRow(row)

    // จัดรูปแบบตัวเลขเงินให้มีคั่นหลักพัน 2 ตำแหน่ง
    r.headers.forEach((h, i) => {
      const isMoney = /เดบิต|เครดิต|ยอด|มูลค่า|ภาษี|ฐาน|คงค้าง|จ่าย|รับ|คงเหลือ/.test(h)
      const col = ws.getColumn(i + 1)
      const maxLen = Math.max(h.length, ...r.rows.slice(0, 200).map((x) => String(x[i] ?? '').length))
      col.width = Math.min(Math.max(maxLen + 2, 10), 42)
      if (isMoney && !/อัตรา|วัน|%/.test(h)) col.numFmt = '#,##0.00'
    })

    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: r.headers.length } }
  }

  const buffer = await wb.xlsx.writeBuffer()

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${safeCompany}-รายงานบัญชี-${stamp}.xlsx`)}`,
      'Cache-Control': 'no-store',
    },
  })
}
