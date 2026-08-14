/**
 * คำนวณเงินเป็น "สตางค์" แบบจำนวนเต็มเสมอ
 * ห้ามบวกลบคูณหารด้วยทศนิยมลอยตัว เพราะ 0.1 + 0.2 ไม่เท่ากับ 0.3
 * และในระบบบัญชี ผลต่างหนึ่งสตางค์ทำให้เดบิตไม่เท่ากับเครดิตได้จริง
 */

/** แปลงจำนวนเงิน (string จาก DB หรือ number จากฟอร์ม) เป็นสตางค์ */
export function toSatang(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

/** แปลงสตางค์กลับเป็นสตริงทศนิยม 2 ตำแหน่ง สำหรับส่งเข้าฐานข้อมูล */
export function fromSatang(s: number): string {
  return (s / 100).toFixed(2)
}

/** คูณด้วยอัตราร้อยละ แล้วปัดเป็นสตางค์เต็ม (ใช้กับ VAT และภาษีหัก ณ ที่จ่าย) */
export function pct(satang: number, ratePercent: string | number): number {
  const rate = typeof ratePercent === 'number' ? ratePercent : Number(ratePercent)
  if (!Number.isFinite(rate)) return 0
  return Math.round((satang * rate) / 100)
}

/** แบ่งยอดตามสัดส่วน โดยปัดเป็นสตางค์เต็ม */
export function proportion(part: number, whole: number, target: number): number {
  if (whole === 0) return 0
  return Math.round((target * part) / whole)
}

/** แสดงผลเป็นตัวเลขไทยพร้อมคั่นหลักพัน */
export function baht(v: string | number | null | undefined, opts?: { blankZero?: boolean }): string {
  const s = toSatang(v)
  if (opts?.blankZero && s === 0) return ''
  return (s / 100).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
]

/** 2026-08-05 -> 5 ส.ค. 2569 (เก็บเป็น ค.ศ. ในฐานข้อมูล แปลงเป็น พ.ศ. เฉพาะตอนแสดง) */
export function thaiDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${THAI_MONTHS[m - 1]} ${y + 543}`
}

/** 2026-08 -> สิงหาคม 2569 */
export function thaiPeriod(name: string | null | undefined): string {
  if (!name) return '-'
  const full = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ]
  const [y, m] = name.split('-').map(Number)
  if (!y || !m) return name
  return `${full[m - 1]} ${y + 543}`
}

export function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
