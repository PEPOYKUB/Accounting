import 'server-only'
import { q, one } from './db'

/**
 * ชุดรายงานสำหรับส่งให้สำนักงานบัญชี
 * ใช้ร่วมกันทั้งการดาวน์โหลดไฟล์และการซิงก์เข้า Google Sheets
 * ทุกรายงานเป็นข้อมูลที่ POSTED แล้วเท่านั้น ใบร่างไม่ถูกส่งออก
 */

export type Report = {
  key: string
  /** ชื่อแท็บใน Google Sheets — ห้ามยาวเกิน 100 ตัวและห้ามมี : \ / ? * [ ] */
  sheetName: string
  title: string
  description: string
  headers: string[]
  rows: (string | number | null)[][]
}

export type ReportScope = {
  /** งวดบัญชีที่ต้องการ ถ้าไม่ระบุ = ทั้งปีบัญชีที่งวดนั้นอยู่ */
  periodId?: string
  /** true = ส่งทั้งปีบัญชี, false = เฉพาะงวดเดียว */
  wholeYear?: boolean
}

type Range = { start: string; end: string; label: string }

async function resolveRange(scope: ReportScope): Promise<Range> {
  if (scope.periodId) {
    const p = await one<{ start_date: string; end_date: string; period_name: string; fy_start: string; fy_end: string; year_code: string }>(
      `SELECT p.start_date::text, p.end_date::text, p.period_name,
              f.start_date::text AS fy_start, f.end_date::text AS fy_end, f.year_code
         FROM acc.accounting_periods p
         JOIN acc.fiscal_years f ON f.id = p.fiscal_year_id
        WHERE p.id = $1::bigint`,
      [scope.periodId]
    )
    if (p) {
      return scope.wholeYear
        ? { start: p.fy_start, end: p.fy_end, label: `ปีบัญชี ${p.year_code}` }
        : { start: p.start_date, end: p.end_date, label: `งวด ${p.period_name}` }
    }
  }

  // ไม่ได้ระบุงวด — ใช้ทั้งปีบัญชีล่าสุดที่มีรายการ
  const fy = await one<{ start_date: string; end_date: string; year_code: string }>(
    `SELECT f.start_date::text, f.end_date::text, f.year_code
       FROM acc.fiscal_years f
      ORDER BY f.start_date DESC LIMIT 1`
  )
  if (fy) return { start: fy.start_date, end: fy.end_date, label: `ปีบัญชี ${fy.year_code}` }

  const today = new Date().toISOString().slice(0, 10)
  return { start: '1900-01-01', end: today, label: 'ทั้งหมด' }
}

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))

export async function buildReports(scope: ReportScope = {}): Promise<{
  range: Range
  company: string
  generatedAt: string
  reports: Report[]
}> {
  const range = await resolveRange(scope)
  const companyRow = await one<{ value: string }>(
    `SELECT value FROM acc.system_settings WHERE key = 'COMPANY_NAME'`
  )
  const company = companyRow?.value || 'กิจการ'
  const generatedAt = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })

  const reports: Report[] = []

  // ── 1. สมุดรายวัน ────────────────────────────────────────────────
  {
    const rows = await q<Record<string, unknown>>(
      `SELECT je.entry_no, je.entry_date::text AS entry_date, p.period_name,
              je.source_type::text AS source_type, je.description,
              l.line_no, a.account_code, a.account_name,
              l.debit_amount, l.credit_amount,
              COALESCE(l.description, '') AS line_memo,
              COALESCE(bp.partner_name, '') AS partner_name,
              COALESCE(cc.name, '') AS cost_center,
              COALESCE(l.reference_doc, '') AS reference_doc,
              cu.full_name AS created_by, COALESCE(au.full_name, '') AS approved_by
         FROM acc.journal_entries je
         JOIN acc.accounting_periods p ON p.id = je.period_id
         JOIN acc.journal_entry_lines l ON l.journal_entry_id = je.id
         JOIN acc.chart_of_accounts a ON a.id = l.account_id
         JOIN acc.app_users cu ON cu.id = je.created_by
         LEFT JOIN acc.app_users au ON au.id = je.approved_by
         LEFT JOIN acc.business_partners bp ON bp.id = l.partner_id
         LEFT JOIN acc.cost_centers cc ON cc.id = l.cost_center_id
        WHERE je.status = 'POSTED'
          AND je.entry_date BETWEEN $1::date AND $2::date
        ORDER BY je.entry_date, je.entry_no, l.line_no`,
      [range.start, range.end]
    )
    reports.push({
      key: 'journal',
      sheetName: 'สมุดรายวัน',
      title: 'สมุดรายวันทั่วไป',
      description: 'ทุกรายการบัญชีที่ลงบัญชีแล้ว แยกรายบรรทัด',
      headers: [
        'เลขที่ใบสำคัญ', 'วันที่', 'งวด', 'ที่มา', 'คำอธิบายใบสำคัญ',
        'บรรทัด', 'รหัสบัญชี', 'ชื่อบัญชี', 'เดบิต', 'เครดิต',
        'คำอธิบายบรรทัด', 'คู่ค้า', 'ศูนย์ต้นทุน', 'เอกสารอ้างอิง',
        'ผู้บันทึก', 'ผู้อนุมัติ',
      ],
      rows: rows.map((r) => [
        r.entry_no as string, r.entry_date as string, r.period_name as string,
        r.source_type as string, r.description as string,
        n(r.line_no), r.account_code as string, r.account_name as string,
        n(r.debit_amount), n(r.credit_amount),
        r.line_memo as string, r.partner_name as string, r.cost_center as string,
        r.reference_doc as string, r.created_by as string, r.approved_by as string,
      ]),
    })
  }

  // ── 2. งบทดลอง ───────────────────────────────────────────────────
  {
    const rows = await q<Record<string, unknown>>(
      `WITH mv AS (
         SELECT m.account_id,
                SUM(m.debit_amount)  FILTER (WHERE m.entry_date < $1::date) AS pre_dr,
                SUM(m.credit_amount) FILTER (WHERE m.entry_date < $1::date) AS pre_cr,
                SUM(m.debit_amount)  FILTER (WHERE m.entry_date >= $1::date) AS cur_dr,
                SUM(m.credit_amount) FILTER (WHERE m.entry_date >= $1::date) AS cur_cr
           FROM acc.v_gl_movements m
          WHERE m.entry_date <= $2::date
          GROUP BY m.account_id
       )
       SELECT a.account_code, a.account_name, a.account_type::text AS account_type,
              COALESCE(mv.pre_dr,0) - COALESCE(mv.pre_cr,0) AS opening,
              COALESCE(mv.cur_dr,0) AS period_dr,
              COALESCE(mv.cur_cr,0) AS period_cr,
              COALESCE(mv.pre_dr,0) - COALESCE(mv.pre_cr,0)
                + COALESCE(mv.cur_dr,0) - COALESCE(mv.cur_cr,0) AS closing
         FROM acc.chart_of_accounts a
         JOIN mv ON mv.account_id = a.id
        ORDER BY a.account_code`,
      [range.start, range.end]
    )
    const TYPE_TH: Record<string, string> = {
      ASSET: 'สินทรัพย์', LIABILITY: 'หนี้สิน', EQUITY: 'ส่วนของผู้ถือหุ้น',
      REVENUE: 'รายได้', EXPENSE: 'ค่าใช้จ่าย',
    }
    reports.push({
      key: 'trial-balance',
      sheetName: 'งบทดลอง',
      title: 'งบทดลอง',
      description: 'ยอดยกมา เคลื่อนไหวในช่วง และยอดคงเหลือทุกบัญชี',
      headers: ['รหัสบัญชี', 'ชื่อบัญชี', 'ประเภท', 'ยอดยกมา', 'เดบิต', 'เครดิต', 'คงเหลือเดบิต', 'คงเหลือเครดิต'],
      rows: rows.map((r) => {
        const close = n(r.closing)
        return [
          r.account_code as string, r.account_name as string,
          TYPE_TH[r.account_type as string] ?? (r.account_type as string),
          n(r.opening), n(r.period_dr), n(r.period_cr),
          close > 0 ? close : 0, close < 0 ? -close : 0,
        ]
      }),
    })
  }

  // ── 3. รายงานภาษีขาย ─────────────────────────────────────────────
  {
    const rows = await q<Record<string, unknown>>(
      `SELECT p.period_name, v.seq_no, v.tax_invoice_date::text AS d, v.tax_invoice_no,
              v.customer_name, COALESCE(v.customer_tax_id,'') AS tax_id,
              COALESCE(v.customer_branch,'') AS branch,
              v.base_amount, v.vat_amount
         FROM acc.vat_output_items v
         JOIN acc.accounting_periods p ON p.id = v.period_id
        WHERE v.tax_invoice_date BETWEEN $1::date AND $2::date
        ORDER BY p.start_date, v.seq_no`,
      [range.start, range.end]
    )
    reports.push({
      key: 'vat-output',
      sheetName: 'รายงานภาษีขาย',
      title: 'รายงานภาษีขาย',
      description: 'รูปแบบตามประกาศอธิบดีกรมสรรพากร ใช้ยื่น ภพ.30',
      headers: ['งวด', 'ลำดับ', 'วันที่', 'เลขที่ใบกำกับภาษี', 'ชื่อผู้ซื้อ', 'เลขประจำตัวผู้เสียภาษี', 'สาขา', 'มูลค่าสินค้า/บริการ', 'ภาษีมูลค่าเพิ่ม'],
      rows: rows.map((r) => [
        r.period_name as string, n(r.seq_no), r.d as string, r.tax_invoice_no as string,
        r.customer_name as string, r.tax_id as string, r.branch as string,
        n(r.base_amount), n(r.vat_amount),
      ]),
    })
  }

  // ── 4. รายงานภาษีซื้อ ─────────────────────────────────────────────
  {
    const rows = await q<Record<string, unknown>>(
      `SELECT p.period_name, v.seq_no, v.tax_invoice_date::text AS d, v.tax_invoice_no,
              v.vendor_name, COALESCE(v.vendor_tax_id,'') AS tax_id,
              COALESCE(v.vendor_branch,'') AS branch,
              v.base_amount, v.vat_amount, v.is_claimable
         FROM acc.vat_input_items v
         JOIN acc.accounting_periods p ON p.id = v.period_id
        WHERE v.tax_invoice_date BETWEEN $1::date AND $2::date
        ORDER BY p.start_date, v.seq_no`,
      [range.start, range.end]
    )
    reports.push({
      key: 'vat-input',
      sheetName: 'รายงานภาษีซื้อ',
      title: 'รายงานภาษีซื้อ',
      description: 'แยกภาษีซื้อต้องห้ามไว้แล้ว ใช้ยื่น ภพ.30',
      headers: ['งวด', 'ลำดับ', 'วันที่', 'เลขที่ใบกำกับภาษี', 'ชื่อผู้ขาย', 'เลขประจำตัวผู้เสียภาษี', 'สาขา', 'มูลค่าสินค้า/บริการ', 'ภาษีมูลค่าเพิ่ม', 'ใช้สิทธิได้'],
      rows: rows.map((r) => [
        r.period_name as string, n(r.seq_no), r.d as string, r.tax_invoice_no as string,
        r.vendor_name as string, r.tax_id as string, r.branch as string,
        n(r.base_amount), n(r.vat_amount), r.is_claimable ? 'ใช้ได้' : 'ต้องห้าม',
      ]),
    })
  }

  // ── 5. ภาษีหัก ณ ที่จ่ายที่เราออกให้ผู้ขาย ─────────────────────────
  {
    const rows = await q<Record<string, unknown>>(
      `SELECT w.doc_no, w.issue_date::text AS d, p.period_name,
              bp.partner_name, COALESCE(bp.tax_id,'') AS tax_id,
              w.wht_form::text AS form, w.income_type,
              w.base_amount, w.wht_rate, w.wht_amount, w.is_remitted
         FROM acc.wht_certificates w
         JOIN acc.business_partners bp ON bp.id = w.payee_id
         JOIN acc.accounting_periods p ON p.id = w.period_id
        WHERE w.issue_date BETWEEN $1::date AND $2::date
        ORDER BY w.issue_date, w.doc_no`,
      [range.start, range.end]
    )
    reports.push({
      key: 'wht-issued',
      sheetName: 'หัก ณ ที่จ่าย-เราหัก',
      title: 'ภาษีหัก ณ ที่จ่ายที่เราหักผู้ขาย',
      description: 'ใช้ยื่น ภงด.3 และ ภงด.53',
      headers: ['เลขที่หนังสือรับรอง', 'วันที่', 'งวด', 'ผู้ถูกหัก', 'เลขประจำตัวผู้เสียภาษี', 'แบบยื่น', 'ประเภทเงินได้', 'ฐานภาษี', 'อัตรา %', 'ภาษีที่หัก', 'นำส่งแล้ว'],
      rows: rows.map((r) => [
        r.doc_no as string, r.d as string, r.period_name as string,
        r.partner_name as string, r.tax_id as string,
        r.form as string, r.income_type as string,
        n(r.base_amount), n(r.wht_rate), n(r.wht_amount),
        r.is_remitted ? 'นำส่งแล้ว' : 'ยังไม่นำส่ง',
      ]),
    })
  }

  // ── 6. ภาษีที่ถูกลูกค้าหัก (เครดิต ภงด.50) ─────────────────────────
  {
    const rows = await q<Record<string, unknown>>(
      `SELECT w.issue_date::text AS d, bp.partner_name, COALESCE(bp.tax_id,'') AS tax_id,
              COALESCE(w.certificate_no,'') AS cert_no,
              COALESCE(r.doc_no,'') AS receipt_no,
              w.base_amount, w.wht_rate, w.wht_amount, w.is_document_received
         FROM acc.wht_received w
         JOIN acc.business_partners bp ON bp.id = w.customer_id
         LEFT JOIN acc.ar_receipts r ON r.id = w.receipt_id
        WHERE w.issue_date BETWEEN $1::date AND $2::date
        ORDER BY w.issue_date`,
      [range.start, range.end]
    )
    reports.push({
      key: 'wht-received',
      sheetName: 'หัก ณ ที่จ่าย-ถูกหัก',
      title: 'ภาษีเงินได้ที่ถูกลูกค้าหัก ณ ที่จ่าย',
      description: 'ใช้เป็นเครดิตภาษีตอนยื่น ภงด.50 — ต้องมีหนังสือรับรองตัวจริงครบทุกรายการ',
      headers: ['วันที่', 'ลูกค้า', 'เลขประจำตัวผู้เสียภาษี', 'เลขที่หนังสือรับรอง', 'เลขที่ใบเสร็จ', 'ฐานภาษี', 'อัตรา %', 'ภาษีที่ถูกหัก', 'ได้รับเอกสารแล้ว'],
      rows: rows.map((r) => [
        r.d as string, r.partner_name as string, r.tax_id as string,
        r.cert_no as string, r.receipt_no as string,
        n(r.base_amount), n(r.wht_rate), n(r.wht_amount),
        r.is_document_received ? 'ได้รับแล้ว' : 'ยังไม่ได้รับ',
      ]),
    })
  }

  // ── 7. ลูกหนี้คงค้าง ──────────────────────────────────────────────
  {
    const rows = await q<Record<string, unknown>>(
      `SELECT i.doc_no, bp.partner_name, COALESCE(bp.tax_id,'') AS tax_id,
              i.issue_date::text AS issue_date, i.due_date::text AS due_date,
              i.total_amount, i.paid_amount, i.balance_due,
              GREATEST(CURRENT_DATE - i.due_date, 0) AS overdue_days,
              i.status::text AS status
         FROM acc.ar_invoices i
         JOIN acc.business_partners bp ON bp.id = i.customer_id
        WHERE i.balance_due > 0 AND i.status NOT IN ('DRAFT','CANCELLED')
        ORDER BY bp.partner_name, i.due_date`
    )
    reports.push({
      key: 'ar-open',
      sheetName: 'ลูกหนี้คงค้าง',
      title: 'ลูกหนี้การค้าคงค้าง',
      description: 'ยอดที่ลูกค้ายังไม่ชำระ ณ วันที่ส่งออก',
      headers: ['เลขที่ใบแจ้งหนี้', 'ลูกค้า', 'เลขประจำตัวผู้เสียภาษี', 'วันที่', 'ครบกำหนด', 'ยอดรวม', 'รับชำระแล้ว', 'คงค้าง', 'เกินกำหนด (วัน)', 'สถานะ'],
      rows: rows.map((r) => [
        r.doc_no as string, r.partner_name as string, r.tax_id as string,
        r.issue_date as string, r.due_date as string,
        n(r.total_amount), n(r.paid_amount), n(r.balance_due),
        n(r.overdue_days), r.status as string,
      ]),
    })
  }

  // ── 8. เจ้าหนี้คงค้าง ─────────────────────────────────────────────
  {
    const rows = await q<Record<string, unknown>>(
      `SELECT b.doc_no, COALESCE(b.vendor_invoice_no,'') AS vendor_doc,
              bp.partner_name, COALESCE(bp.tax_id,'') AS tax_id,
              b.bill_date::text AS bill_date, b.due_date::text AS due_date,
              b.total_amount, b.paid_amount, b.balance_due,
              GREATEST(CURRENT_DATE - b.due_date, 0) AS overdue_days,
              b.status::text AS status
         FROM acc.ap_bills b
         JOIN acc.business_partners bp ON bp.id = b.vendor_id
        WHERE b.balance_due > 0 AND b.status NOT IN ('DRAFT','CANCELLED')
        ORDER BY bp.partner_name, b.due_date`
    )
    reports.push({
      key: 'ap-open',
      sheetName: 'เจ้าหนี้คงค้าง',
      title: 'เจ้าหนี้การค้าคงค้าง',
      description: 'ยอดที่ยังไม่ได้จ่ายผู้ขาย ณ วันที่ส่งออก',
      headers: ['เลขที่ใบตั้งหนี้', 'เลขที่เอกสารผู้ขาย', 'ผู้ขาย', 'เลขประจำตัวผู้เสียภาษี', 'วันที่', 'ครบกำหนด', 'ยอดรวม', 'จ่ายแล้ว', 'ค้างจ่าย', 'เกินกำหนด (วัน)', 'สถานะ'],
      rows: rows.map((r) => [
        r.doc_no as string, r.vendor_doc as string, r.partner_name as string, r.tax_id as string,
        r.bill_date as string, r.due_date as string,
        n(r.total_amount), n(r.paid_amount), n(r.balance_due),
        n(r.overdue_days), r.status as string,
      ]),
    })
  }

  // ── 9. ผังบัญชี ───────────────────────────────────────────────────
  {
    const rows = await q<Record<string, unknown>>(
      `SELECT a.account_code, a.account_name, COALESCE(a.account_name_en,'') AS name_en,
              a.account_type::text AS account_type, COALESCE(a.account_subtype,'') AS subtype,
              a.normal_balance::text AS normal_balance,
              a.allow_posting, a.is_contra, a.is_active,
              COALESCE(a.npae_report_line,'') AS report_line
         FROM acc.chart_of_accounts a
        ORDER BY a.account_code`
    )
    const TYPE_TH: Record<string, string> = {
      ASSET: 'สินทรัพย์', LIABILITY: 'หนี้สิน', EQUITY: 'ส่วนของผู้ถือหุ้น',
      REVENUE: 'รายได้', EXPENSE: 'ค่าใช้จ่าย',
    }
    reports.push({
      key: 'chart-of-accounts',
      sheetName: 'ผังบัญชี',
      title: 'ผังบัญชี',
      description: 'รหัสและชื่อบัญชีทั้งหมดของกิจการ',
      headers: ['รหัสบัญชี', 'ชื่อบัญชี', 'ชื่อภาษาอังกฤษ', 'ประเภท', 'กลุ่มย่อย', 'ด้านปกติ', 'ลงรายการได้', 'บัญชีปรับมูลค่า', 'ใช้งานอยู่', 'บรรทัดในงบการเงิน'],
      rows: rows.map((r) => [
        r.account_code as string, r.account_name as string, r.name_en as string,
        TYPE_TH[r.account_type as string] ?? (r.account_type as string),
        r.subtype as string,
        r.normal_balance === 'DEBIT' ? 'เดบิต' : 'เครดิต',
        r.allow_posting ? 'ได้' : 'ไม่ได้ (บัญชีคุม)',
        r.is_contra ? 'ใช่' : '',
        r.is_active ? 'ใช้งาน' : 'ปิดใช้งาน',
        r.report_line as string,
      ]),
    })
  }

  return { range, company, generatedAt, reports }
}

/** รายการงวดบัญชีสำหรับให้เลือกช่วงส่งออก */
export async function exportPeriods() {
  return q<{ id: string; period_name: string; status: string; year_code: string }>(
    `SELECT p.id::text, p.period_name, p.status::text, f.year_code
       FROM acc.accounting_periods p
       JOIN acc.fiscal_years f ON f.id = p.fiscal_year_id
      ORDER BY p.start_date DESC`
  )
}
