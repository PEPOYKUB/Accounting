export const SOURCE_TH: Record<string, string> = {
  OPENING: 'ยอดยกมา',
  SALES_INVOICE: 'ใบแจ้งหนี้',
  SALES_RECEIPT: 'รับชำระ',
  SALES_ADVANCE: 'รับล่วงหน้า',
  CREDIT_NOTE: 'ใบลดหนี้',
  DEBIT_NOTE: 'ใบเพิ่มหนี้',
  PURCHASE_BILL: 'ตั้งหนี้',
  PURCHASE_PAYMENT: 'จ่ายชำระ',
  PAYROLL: 'เงินเดือน',
  DEPRECIATION: 'ค่าเสื่อมราคา',
  TAX_REMITTANCE: 'นำส่งภาษี',
  BANK: 'ธนาคาร',
  ADJUSTMENT: 'ปรับปรุง',
  REVERSAL: 'กลับรายการ',
  CLOSING: 'ปิดบัญชี',
  MANUAL: 'ลงบัญชีมือ',
}

export const DOC_STATUS_TH: Record<string, { text: string; cls: string }> = {
  DRAFT: { text: 'ร่าง', cls: 'plain' },
  APPROVED: { text: 'อนุมัติแล้ว', cls: 'info' },
  POSTED: { text: 'ลงบัญชีแล้ว', cls: 'info' },
  PARTIAL_PAID: { text: 'ชำระบางส่วน', cls: 'warn' },
  PAID: { text: 'ชำระครบแล้ว', cls: 'ok' },
  OVERDUE: { text: 'เกินกำหนด', cls: 'danger' },
  CANCELLED: { text: 'ยกเลิก', cls: 'danger' },
}

export const ACCOUNT_TYPE_TH: Record<string, string> = {
  ASSET: 'สินทรัพย์',
  LIABILITY: 'หนี้สิน',
  EQUITY: 'ส่วนของผู้ถือหุ้น',
  REVENUE: 'รายได้',
  EXPENSE: 'ค่าใช้จ่าย',
}

export const PERIOD_STATUS_TH: Record<string, { text: string; cls: string }> = {
  OPEN: { text: 'เปิดอยู่', cls: 'ok' },
  CLOSED: { text: 'ปิดแล้ว', cls: 'plain' },
  LOCKED: { text: 'ล็อกถาวร', cls: 'danger' },
}

export const WHT_FORM_TH: Record<string, string> = {
  PND1: 'ภงด.1 (เงินเดือน)',
  PND2: 'ภงด.2',
  PND3: 'ภงด.3 (บุคคลธรรมดา)',
  PND53: 'ภงด.53 (นิติบุคคล)',
  PND54: 'ภงด.54 (ต่างประเทศ)',
}
