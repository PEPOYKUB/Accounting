import type { ComboOption } from '@/components/Combo'

/*
  อัตราภาษีหัก ณ ที่จ่ายที่ใช้จริงในธุรกิจบริการ

  ใส่คำอธิบายกำกับไว้ด้วย เพราะคนคีย์มักจำได้ว่า "ค่าเช่าหัก 5"
  แต่ไม่แน่ใจว่าค่าโฆษณาหักเท่าไร การให้เลือกจากรายการจึงทั้งเร็วกว่าและผิดน้อยกว่าพิมพ์เอง

  ใช้ร่วมกันทั้งฝั่งตั้งหนี้ (เราเป็นผู้หัก) และฝั่งรับชำระ (ลูกค้าหักเรา)
*/
/*
  ฐานข้อมูลเก็บอัตราเป็น NUMERIC จึงส่งกลับมาเป็น "3.000"
  ถ้าเอาไปเทียบกับตัวเลือกที่เป็น "3" ตรง ๆ จะไม่ตรงกัน ช่องเลือกจะขึ้นว่างทั้งที่มีค่าอยู่
  จึงตัดศูนย์ท้ายทิ้งให้เป็นรูปแบบเดียวกันก่อนเสมอ
*/
export function normRate(v: string | null | undefined, fallback = '3'): string {
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : fallback
}

export const WHT_RATES: ComboOption[] = [
  { value: '0', label: 'ไม่หัก', hint: '0%' },
  { value: '1', label: 'ค่าขนส่ง', hint: '1%' },
  { value: '2', label: 'ค่าโฆษณา', hint: '2%' },
  { value: '3', label: 'ค่าบริการ / วิชาชีพอิสระ', hint: '3%' },
  { value: '5', label: 'ค่าเช่า / รางวัล', hint: '5%' },
]
