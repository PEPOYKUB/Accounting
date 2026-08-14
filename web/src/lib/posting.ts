'use server'

import { revalidatePath } from 'next/cache'
import type { PoolClient } from 'pg'
import { tx, dbErrorMessage, isFrameworkError, one } from './db'
import { requirePermission } from './auth'
import { toSatang, fromSatang, pct, proportion } from './money'

/**
 * หาผู้อนุมัติที่ไม่ใช่ผู้บันทึกเอง
 * ฐานข้อมูลบังคับกฎนี้อยู่แล้ว ที่นี่หาไว้ล่วงหน้าเพื่อให้ข้อความผิดพลาดอ่านรู้เรื่อง
 */
async function findApprover(createdBy: string): Promise<string> {
  const setting = await one<{ value: string }>(
    `SELECT value FROM acc.system_settings WHERE key = 'ENFORCE_MAKER_CHECKER'`
  )
  if (setting?.value !== 'true') return createdBy

  const approver = await one<{ id: string }>(
    `SELECT u.id::text
       FROM acc.app_users u
       JOIN acc.user_roles ur ON ur.user_id = u.id
      WHERE ur.role_code IN ('CONTROLLER','SENIOR_ACCOUNTANT')
        AND u.is_active AND u.id <> $1::bigint
      ORDER BY CASE ur.role_code WHEN 'CONTROLLER' THEN 0 ELSE 1 END, u.id
      LIMIT 1`,
    [createdBy]
  )
  if (!approver) {
    throw new Error(
      'ไม่พบผู้มีสิทธิ์อนุมัติที่ไม่ใช่ผู้บันทึกเอง — ระบบบังคับให้ผู้อนุมัติเป็นคนละคนกับผู้บันทึก ' +
      '(ถ้าทีมมีคนเดียวจริง ให้ตั้ง ENFORCE_MAKER_CHECKER เป็น false ในตาราง system_settings)'
    )
  }
  return approver.id
}

// =====================================================================
// ชั้นนี้คือการ implement docs/posting-rules.md ตรง ๆ
// ทุกฟังก์ชันทำงานในทรานแซกชันเดียว: บันทึกเอกสาร -> ลงบัญชี -> อัปเดตบัญชีย่อย
// ถ้าขั้นใดพลาด ทั้งชุดถูกยกเลิก ไม่มีทางเกิดเอกสารที่ไม่มีรายการบัญชี
// =====================================================================

export type ActionResult = { ok: true; id: string; docNo: string } | { ok: false; error: string }

type JeLine = {
  code: string
  dr?: string
  cr?: string
  memo?: string
  partner_id?: string | number | null
  cost_center_id?: string | number | null
  ref?: string
}

/** เรียก acc.next_doc_no() ซึ่งกันเลขซ้ำด้วยการล็อกแถว */
async function nextDocNo(c: PoolClient, docType: string, date: string): Promise<string> {
  const r = await c.query('SELECT acc.next_doc_no($1, $2::date) AS no', [docType, date])
  return r.rows[0].no as string
}

async function postJournal(
  c: PoolClient,
  args: {
    entryNo: string
    date: string
    source: string
    description: string
    lines: JeLine[]
    createdBy: string
    approvedBy: string
    sourceTable?: string
    sourceDocId?: string
  }
): Promise<string> {
  const r = await c.query(
    `SELECT acc.post_journal_entry($1,$2::date,$3::acc.je_source,$4,$5::jsonb,$6::bigint,$7::bigint,$8,$9::bigint) AS id`,
    [
      args.entryNo,
      args.date,
      args.source,
      args.description,
      JSON.stringify(args.lines),
      args.createdBy,
      args.approvedBy,
      args.sourceTable ?? null,
      args.sourceDocId ?? null,
    ]
  )
  return r.rows[0].id as string
}

/** ลำดับที่ถัดไปในรายงานภาษีของงวดนั้น */
async function nextVatSeq(c: PoolClient, table: 'vat_output_items' | 'vat_input_items', periodId: string) {
  const r = await c.query(
    `SELECT COALESCE(MAX(seq_no),0) + 1 AS n FROM acc.${table} WHERE period_id = $1::bigint`,
    [periodId]
  )
  return r.rows[0].n as number
}

async function periodIdFor(c: PoolClient, date: string): Promise<string> {
  const r = await c.query(
    `SELECT id::text FROM acc.accounting_periods WHERE $1::date BETWEEN start_date AND end_date`,
    [date]
  )
  if (!r.rows[0]) throw new Error(`ไม่พบงวดบัญชีที่ครอบคลุมวันที่ ${date} — ต้องสร้างงวดก่อน`)
  return r.rows[0].id as string
}

// =====================================================================
// R-1 · ออกใบแจ้งหนี้
//   Dr ลูกหนี้การค้า / Cr รายได้ + Cr พักภาษีขาย
//   ธุรกิจบริการยังไม่ถึงจุดรับผิดทาง VAT จึงเข้าบัญชีพักก่อน
// =====================================================================
export async function createInvoice(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('doc.create')
    const customerId = String(formData.get('customer_id') ?? '')
    const issueDate = String(formData.get('issue_date') ?? '')
    const dueDate = String(formData.get('due_date') ?? '')
    const whtRate = String(formData.get('expected_wht_rate') ?? '3')
    const rows = JSON.parse(String(formData.get('lines') ?? '[]')) as Array<{
      description: string
      quantity: string
      unit_price: string
      revenue_account_code: string
      vat_rate: string
      cost_center_id?: string
    }>

    if (!customerId) return { ok: false, error: 'ต้องเลือกลูกค้า' }
    if (rows.length === 0) return { ok: false, error: 'ต้องมีรายการอย่างน้อย 1 บรรทัด' }

    const approvedBy = await findApprover(user.id)

    const computed = rows.map((r) => {
      const qty = Number(r.quantity || '1')
      const amount = Math.round(toSatang(r.unit_price) * qty)
      const vat = pct(amount, r.vat_rate || '0')
      return { ...r, amountS: amount, vatS: vat }
    })

    const subtotalS = computed.reduce((a, r) => a + r.amountS, 0)
    const vatS = computed.reduce((a, r) => a + r.vatS, 0)
    const totalS = subtotalS + vatS

    if (subtotalS <= 0) return { ok: false, error: 'ยอดเงินต้องมากกว่าศูนย์' }

    const result = await tx(user.username, async (c) => {
      const docNo = await nextDocNo(c, 'INV', issueDate)

      const inv = await c.query(
        `INSERT INTO acc.ar_invoices
           (doc_no, customer_id, issue_date, due_date, subtotal, vat_base, vat_amount,
            total_amount, expected_wht_rate, balance_due, status, created_by)
         VALUES ($1,$2::bigint,$3::date,$4::date,$5,$6,$7,$8,$9,$8,'POSTED',$10::bigint)
         RETURNING id::text`,
        [
          docNo, customerId, issueDate, dueDate,
          fromSatang(subtotalS), fromSatang(subtotalS), fromSatang(vatS),
          fromSatang(totalS), whtRate || null, user.id,
        ]
      )
      const invoiceId = inv.rows[0].id as string

      let lineNo = 0
      for (const r of computed) {
        lineNo++
        await c.query(
          `INSERT INTO acc.ar_invoice_lines
             (invoice_id, line_no, description, quantity, unit_price, line_amount,
              revenue_account_id, vat_rate, vat_amount, cost_center_id)
           VALUES ($1::bigint,$2,$3,$4,$5,$6,
                   (SELECT id FROM acc.chart_of_accounts WHERE account_code = $7),
                   $8,$9,$10::bigint)`,
          [
            invoiceId, lineNo, r.description, r.quantity || '1',
            fromSatang(toSatang(r.unit_price)), fromSatang(r.amountS),
            r.revenue_account_code, r.vat_rate || '0', fromSatang(r.vatS),
            r.cost_center_id || null,
          ]
        )
      }

      // รวมยอดตามบัญชีรายได้ เพื่อไม่ให้ JE มีบรรทัดซ้ำบัญชีเดียวกันโดยไม่จำเป็น
      const byAccount = new Map<string, number>()
      for (const r of computed) {
        byAccount.set(r.revenue_account_code, (byAccount.get(r.revenue_account_code) ?? 0) + r.amountS)
      }

      const lines: JeLine[] = [
        { code: '1100', dr: fromSatang(totalS), partner_id: customerId, ref: docNo, memo: 'ลูกหนี้การค้า' },
        ...[...byAccount.entries()].map(([code, amt]) => ({
          code,
          cr: fromSatang(amt),
          memo: 'รายได้จากการให้บริการ',
        })),
      ]
      if (vatS > 0) {
        lines.push({ code: '2101', cr: fromSatang(vatS), memo: 'พักภาษีขาย รอถึงจุดรับผิด' })
      }

      const jeNo = await nextDocNo(c, 'JV', issueDate)
      const jeId = await postJournal(c, {
        entryNo: jeNo, date: issueDate, source: 'SALES_INVOICE',
        description: `ออกใบแจ้งหนี้ ${docNo}`,
        lines, createdBy: user.id, approvedBy,
        sourceTable: 'ar_invoices', sourceDocId: invoiceId,
      })

      await c.query(`UPDATE acc.ar_invoices SET journal_entry_id = $1::bigint WHERE id = $2::bigint`, [jeId, invoiceId])

      return { id: invoiceId, docNo }
    })

    revalidatePath('/invoices')
    revalidatePath('/')
    return { ok: true, ...result }
  } catch (err) {
    if (isFrameworkError(err)) throw err
    return { ok: false, error: dbErrorMessage(err) }
  }
}

// =====================================================================
// R-2 · รับชำระเงิน + ออกใบกำกับภาษี
//   Dr ธนาคาร (สุทธิ) + Dr ภาษีถูกหัก ณ ที่จ่าย / Cr ลูกหนี้
//   พร้อมโอนพักภาษีขาย -> ภาษีขาย ตามสัดส่วนที่รับจริง
// =====================================================================
export async function createReceipt(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('doc.create')
    const customerId = String(formData.get('customer_id') ?? '')
    const receiptDate = String(formData.get('receipt_date') ?? '')
    const bankAccountId = String(formData.get('bank_account_id') ?? '')
    const feeS = toSatang(String(formData.get('fee_amount') ?? '0'))
    const allocs = JSON.parse(String(formData.get('allocations') ?? '[]')) as Array<{
      invoice_id: string
      applied_amount: string
      wht_rate: string
    }>

    const picked = allocs.filter((a) => toSatang(a.applied_amount) > 0)
    if (picked.length === 0) return { ok: false, error: 'ต้องระบุยอดรับชำระอย่างน้อย 1 ใบแจ้งหนี้' }

    const approvedBy = await findApprover(user.id)

    const result = await tx(user.username, async (c) => {
      const periodId = await periodIdFor(c, receiptDate)
      const bank = await c.query(
        `SELECT b.id::text, c.account_code
           FROM acc.bank_accounts b JOIN acc.chart_of_accounts c ON c.id = b.gl_account_id
          WHERE b.id = $1::bigint`,
        [bankAccountId]
      )
      if (!bank.rows[0]) throw new Error('ไม่พบบัญชีธนาคารที่เลือก')
      const bankCode = bank.rows[0].account_code as string

      let grossS = 0
      let whtTotalS = 0
      let vatTransferS = 0
      const details: Array<{
        invoiceId: string; docNo: string; appliedS: number; vatPartS: number; baseS: number; whtS: number
      }> = []

      for (const a of picked) {
        const inv = await c.query(
          `SELECT id::text, doc_no, subtotal, vat_amount, total_amount, balance_due
             FROM acc.ar_invoices WHERE id = $1::bigint FOR UPDATE`,
          [a.invoice_id]
        )
        if (!inv.rows[0]) throw new Error('ไม่พบใบแจ้งหนี้ที่เลือก')
        const row = inv.rows[0]

        const appliedS = toSatang(a.applied_amount)
        const balanceS = toSatang(row.balance_due)
        if (appliedS > balanceS) {
          throw new Error(`ยอดรับชำระของ ${row.doc_no} เกินยอดค้าง (ค้างอยู่ ${row.balance_due})`)
        }

        // แยกส่วน VAT ออกจากยอดที่รับตามสัดส่วน แล้วส่วนที่เหลือคือฐานก่อนภาษี
        const vatPartS = proportion(toSatang(row.vat_amount), toSatang(row.total_amount), appliedS)
        const baseS = appliedS - vatPartS
        const whtS = pct(baseS, a.wht_rate || '0')

        grossS += appliedS
        vatTransferS += vatPartS
        whtTotalS += whtS
        details.push({ invoiceId: row.id, docNo: row.doc_no, appliedS, vatPartS, baseS, whtS })
      }

      const netS = grossS - whtTotalS - feeS
      const docNo = await nextDocNo(c, 'RC', receiptDate)
      const taxInvoiceNo = await nextDocNo(c, 'TXI', receiptDate)

      const rc = await c.query(
        `INSERT INTO acc.ar_receipts
           (doc_no, customer_id, receipt_date, tax_invoice_no, tax_invoice_date,
            gross_amount, wht_amount, fee_amount, net_received, payment_method,
            bank_account_id, status, created_by)
         VALUES ($1,$2::bigint,$3::date,$4,$3::date,$5,$6,$7,$8,'TRANSFER',$9::bigint,'POSTED',$10::bigint)
         RETURNING id::text`,
        [
          docNo, customerId, receiptDate, taxInvoiceNo,
          fromSatang(grossS), fromSatang(whtTotalS), fromSatang(feeS), fromSatang(netS),
          bankAccountId, user.id,
        ]
      )
      const receiptId = rc.rows[0].id as string

      const lines: JeLine[] = [
        { code: bankCode, dr: fromSatang(netS), memo: 'เงินเข้าบัญชีจริง' },
      ]
      if (whtTotalS > 0) {
        lines.push({
          code: '1160', dr: fromSatang(whtTotalS), partner_id: customerId,
          memo: 'ภาษีเงินได้ถูกหัก ณ ที่จ่าย',
        })
      }
      if (feeS > 0) lines.push({ code: '5190', dr: fromSatang(feeS), memo: 'ค่าธรรมเนียมโอนเงิน' })
      lines.push({
        code: '1100', cr: fromSatang(grossS), partner_id: customerId,
        ref: details.map((d) => d.docNo).join(', '), memo: 'ตัดลูกหนี้การค้า',
      })
      if (vatTransferS > 0) {
        lines.push({ code: '2101', dr: fromSatang(vatTransferS), memo: 'โอนออกจากพักภาษีขาย' })
        lines.push({ code: '2100', cr: fromSatang(vatTransferS), memo: 'ภาษีขายถึงจุดรับผิดแล้ว' })
      }

      const jeNo = await nextDocNo(c, 'JV', receiptDate)
      const jeId = await postJournal(c, {
        entryNo: jeNo, date: receiptDate, source: 'SALES_RECEIPT',
        description: `รับชำระ ${docNo} + ออกใบกำกับภาษี ${taxInvoiceNo}`,
        lines, createdBy: user.id, approvedBy,
        sourceTable: 'ar_receipts', sourceDocId: receiptId,
      })

      await c.query(`UPDATE acc.ar_receipts SET journal_entry_id = $1::bigint WHERE id = $2::bigint`, [jeId, receiptId])

      const cust = await c.query(
        `SELECT partner_name, tax_id, branch_code FROM acc.business_partners WHERE id = $1::bigint`,
        [customerId]
      )

      for (const d of details) {
        await c.query(
          `INSERT INTO acc.ar_receipt_allocations (receipt_id, invoice_id, applied_amount, wht_amount)
           VALUES ($1::bigint,$2::bigint,$3,$4)`,
          [receiptId, d.invoiceId, fromSatang(d.appliedS), fromSatang(d.whtS)]
        )

        await c.query(
          `UPDATE acc.ar_invoices
              SET paid_amount = paid_amount + $2,
                  balance_due = balance_due - $2,
                  status = CASE WHEN balance_due - $2 <= 0 THEN 'PAID'::acc.doc_status
                                ELSE 'PARTIAL_PAID'::acc.doc_status END
            WHERE id = $1::bigint`,
          [d.invoiceId, fromSatang(d.appliedS)]
        )

        if (d.vatPartS > 0 || d.baseS > 0) {
          const seq = await nextVatSeq(c, 'vat_output_items', periodId)
          await c.query(
            `INSERT INTO acc.vat_output_items
               (period_id, seq_no, tax_invoice_date, tax_invoice_no, customer_name,
                customer_tax_id, customer_branch, base_amount, vat_amount,
                source_type, source_doc_id, journal_entry_id)
             VALUES ($1::bigint,$2,$3::date,$4,$5,$6,$7,$8,$9,'SALES_RECEIPT',$10::bigint,$11::bigint)`,
            [
              periodId, seq, receiptDate, taxInvoiceNo,
              cust.rows[0]?.partner_name ?? '', cust.rows[0]?.tax_id ?? null,
              cust.rows[0]?.branch_code ?? null,
              fromSatang(d.baseS), fromSatang(d.vatPartS), receiptId, jeId,
            ]
          )
        }

        if (d.whtS > 0) {
          await c.query(
            `INSERT INTO acc.wht_received
               (customer_id, receipt_id, issue_date, fiscal_year_id, base_amount, wht_rate, wht_amount)
             SELECT $1::bigint, $2::bigint, $3::date, p.fiscal_year_id, $4, $5, $6
               FROM acc.accounting_periods p WHERE p.id = $7::bigint`,
            [
              customerId, receiptId, receiptDate, fromSatang(d.baseS),
              picked.find((a) => a.invoice_id === d.invoiceId)?.wht_rate ?? '0',
              fromSatang(d.whtS), periodId,
            ]
          )
        }
      }

      return { id: receiptId, docNo }
    })

    revalidatePath('/receipts')
    revalidatePath('/invoices')
    revalidatePath('/')
    return { ok: true, ...result }
  } catch (err) {
    if (isFrameworkError(err)) throw err
    return { ok: false, error: dbErrorMessage(err) }
  }
}

// =====================================================================
// P-1 · ตั้งหนี้ผู้ขาย
//   เจ้าหนี้เป็นยอดเต็ม (รวม VAT) ไม่หักภาษี ณ ที่จ่ายที่ขั้นนี้
// =====================================================================
export async function createBill(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('doc.create')
    const vendorId = String(formData.get('vendor_id') ?? '')
    const billDate = String(formData.get('bill_date') ?? '')
    const dueDate = String(formData.get('due_date') ?? '')
    const vendorInvoiceNo = String(formData.get('vendor_invoice_no') ?? '') || null
    const vatTiming = String(formData.get('vat_timing') ?? 'ON_PAYMENT')
    const whtForm = String(formData.get('wht_form') ?? 'PND53')
    const rows = JSON.parse(String(formData.get('lines') ?? '[]')) as Array<{
      description: string
      line_amount: string
      expense_account_code: string
      vat_rate: string
      wht_rate: string
      cost_center_id?: string
    }>

    if (!vendorId) return { ok: false, error: 'ต้องเลือกผู้ขาย' }
    if (rows.length === 0) return { ok: false, error: 'ต้องมีรายการอย่างน้อย 1 บรรทัด' }

    const approvedBy = await findApprover(user.id)

    const computed = rows.map((r) => {
      const amountS = toSatang(r.line_amount)
      return { ...r, amountS, vatS: pct(amountS, r.vat_rate || '0'), whtS: pct(amountS, r.wht_rate || '0') }
    })
    const subtotalS = computed.reduce((a, r) => a + r.amountS, 0)
    const vatS = computed.reduce((a, r) => a + r.vatS, 0)
    const whtS = computed.reduce((a, r) => a + r.whtS, 0)
    const totalS = subtotalS + vatS

    if (subtotalS <= 0) return { ok: false, error: 'ยอดเงินต้องมากกว่าศูนย์' }

    // อัตราหัก ณ ที่จ่ายรวมของทั้งใบ ใช้เก็บไว้ประมาณการเท่านั้น
    const billWhtRate = subtotalS > 0 ? ((whtS / subtotalS) * 100).toFixed(3) : null

    const result = await tx(user.username, async (c) => {
      const docNo = await nextDocNo(c, 'BL', billDate)

      const bill = await c.query(
        `INSERT INTO acc.ap_bills
           (doc_no, vendor_id, vendor_invoice_no, bill_date, due_date, subtotal, vat_amount,
            total_amount, vat_timing, wht_rate, wht_form, estimated_wht, balance_due, status, created_by)
         VALUES ($1,$2::bigint,$3,$4::date,$5::date,$6,$7,$8,$9::acc.vat_timing,$10,
                 $11::acc.wht_form,$12,$8,'POSTED',$13::bigint)
         RETURNING id::text`,
        [
          docNo, vendorId, vendorInvoiceNo, billDate, dueDate,
          fromSatang(subtotalS), fromSatang(vatS), fromSatang(totalS),
          vatTiming, billWhtRate, whtForm, fromSatang(whtS), user.id,
        ]
      )
      const billId = bill.rows[0].id as string

      let lineNo = 0
      for (const r of computed) {
        lineNo++
        await c.query(
          `INSERT INTO acc.ap_bill_lines
             (bill_id, line_no, description, line_amount, expense_account_id, vat_rate, vat_amount, wht_rate, cost_center_id)
           VALUES ($1::bigint,$2,$3,$4,
                   (SELECT id FROM acc.chart_of_accounts WHERE account_code = $5),
                   $6,$7,$8,$9::bigint)`,
          [
            billId, lineNo, r.description, fromSatang(r.amountS), r.expense_account_code,
            r.vat_rate || '0', fromSatang(r.vatS), r.wht_rate || null, r.cost_center_id || null,
          ]
        )
      }

      const byAccount = new Map<string, number>()
      for (const r of computed) {
        byAccount.set(r.expense_account_code, (byAccount.get(r.expense_account_code) ?? 0) + r.amountS)
      }

      const lines: JeLine[] = [...byAccount.entries()].map(([code, amt]) => ({
        code, dr: fromSatang(amt), memo: 'ค่าใช้จ่าย/สินทรัพย์',
      }))
      if (vatS > 0) {
        lines.push({
          code: vatTiming === 'ON_INVOICE' ? '1150' : '1151',
          dr: fromSatang(vatS),
          memo: vatTiming === 'ON_INVOICE' ? 'ภาษีซื้อ' : 'พักภาษีซื้อ รอใบกำกับภาษี',
        })
      }
      lines.push({
        code: '2000', cr: fromSatang(totalS), partner_id: vendorId, ref: docNo,
        memo: 'เจ้าหนี้การค้า เต็มจำนวน',
      })

      const jeNo = await nextDocNo(c, 'JV', billDate)
      const jeId = await postJournal(c, {
        entryNo: jeNo, date: billDate, source: 'PURCHASE_BILL',
        description: `ตั้งหนี้ ${docNo}`,
        lines, createdBy: user.id, approvedBy,
        sourceTable: 'ap_bills', sourceDocId: billId,
      })

      await c.query(`UPDATE acc.ap_bills SET journal_entry_id = $1::bigint WHERE id = $2::bigint`, [jeId, billId])

      // ใบที่ได้ใบกำกับภาษีทันที เข้ารายงานภาษีซื้อตั้งแต่ตอนตั้งหนี้
      if (vatTiming === 'ON_INVOICE' && vatS > 0) {
        const periodId = await periodIdFor(c, billDate)
        const seq = await nextVatSeq(c, 'vat_input_items', periodId)
        const v = await c.query(
          `SELECT partner_name, tax_id, branch_code FROM acc.business_partners WHERE id = $1::bigint`,
          [vendorId]
        )
        await c.query(
          `INSERT INTO acc.vat_input_items
             (period_id, seq_no, tax_invoice_date, tax_invoice_no, vendor_name,
              vendor_tax_id, vendor_branch, base_amount, vat_amount, source_type, source_doc_id, journal_entry_id)
           VALUES ($1::bigint,$2,$3::date,$4,$5,$6,$7,$8,$9,'PURCHASE_BILL',$10::bigint,$11::bigint)`,
          [
            periodId, seq, billDate, vendorInvoiceNo ?? docNo,
            v.rows[0]?.partner_name ?? '', v.rows[0]?.tax_id ?? null, v.rows[0]?.branch_code ?? null,
            fromSatang(subtotalS), fromSatang(vatS), billId, jeId,
          ]
        )
      }

      return { id: billId, docNo }
    })

    revalidatePath('/bills')
    revalidatePath('/')
    return { ok: true, ...result }
  } catch (err) {
    if (isFrameworkError(err)) throw err
    return { ok: false, error: dbErrorMessage(err) }
  }
}

// =====================================================================
// P-3 · จ่ายชำระเจ้าหนี้ + หักภาษี ณ ที่จ่าย
// =====================================================================
export async function createPayment(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('doc.create')
    const vendorId = String(formData.get('vendor_id') ?? '')
    const paymentDate = String(formData.get('payment_date') ?? '')
    const bankAccountId = String(formData.get('bank_account_id') ?? '')
    const allocs = JSON.parse(String(formData.get('allocations') ?? '[]')) as Array<{
      bill_id: string
      applied_amount: string
    }>

    const picked = allocs.filter((a) => toSatang(a.applied_amount) > 0)
    if (picked.length === 0) return { ok: false, error: 'ต้องระบุยอดจ่ายอย่างน้อย 1 ใบตั้งหนี้' }

    const approvedBy = await findApprover(user.id)

    const result = await tx(user.username, async (c) => {
      const periodId = await periodIdFor(c, paymentDate)
      const bank = await c.query(
        `SELECT c.account_code FROM acc.bank_accounts b
           JOIN acc.chart_of_accounts c ON c.id = b.gl_account_id WHERE b.id = $1::bigint`,
        [bankAccountId]
      )
      if (!bank.rows[0]) throw new Error('ไม่พบบัญชีธนาคารที่เลือก')
      const bankCode = bank.rows[0].account_code as string

      let grossS = 0, whtTotalS = 0, vatTransferS = 0
      const whtByForm = new Map<string, number>()
      const details: Array<{
        billId: string; docNo: string; appliedS: number; baseS: number; vatPartS: number
        whtS: number; whtForm: string; whtRate: string; vendorInvoiceNo: string | null; onPayment: boolean
      }> = []

      for (const a of picked) {
        const b = await c.query(
          `SELECT id::text, doc_no, vendor_invoice_no, subtotal, vat_amount, total_amount,
                  balance_due, vat_timing, wht_rate, wht_form
             FROM acc.ap_bills WHERE id = $1::bigint FOR UPDATE`,
          [a.bill_id]
        )
        if (!b.rows[0]) throw new Error('ไม่พบใบตั้งหนี้ที่เลือก')
        const row = b.rows[0]

        const appliedS = toSatang(a.applied_amount)
        if (appliedS > toSatang(row.balance_due)) {
          throw new Error(`ยอดจ่ายของ ${row.doc_no} เกินยอดค้าง (ค้างอยู่ ${row.balance_due})`)
        }

        const vatPartS = proportion(toSatang(row.vat_amount), toSatang(row.total_amount), appliedS)
        const baseS = appliedS - vatPartS
        const whtS = pct(baseS, row.wht_rate ?? '0')
        const form = (row.wht_form as string) ?? 'PND53'

        grossS += appliedS
        whtTotalS += whtS
        if (row.vat_timing === 'ON_PAYMENT') vatTransferS += vatPartS
        if (whtS > 0) whtByForm.set(form, (whtByForm.get(form) ?? 0) + whtS)

        details.push({
          billId: row.id, docNo: row.doc_no, appliedS, baseS, vatPartS, whtS,
          whtForm: form, whtRate: row.wht_rate ?? '0',
          vendorInvoiceNo: row.vendor_invoice_no, onPayment: row.vat_timing === 'ON_PAYMENT',
        })
      }

      const netS = grossS - whtTotalS
      const docNo = await nextDocNo(c, 'PV', paymentDate)

      const pay = await c.query(
        `INSERT INTO acc.ap_payments
           (doc_no, vendor_id, payment_date, gross_amount, wht_amount, net_paid,
            payment_method, bank_account_id, status, created_by)
         VALUES ($1,$2::bigint,$3::date,$4,$5,$6,'TRANSFER',$7::bigint,'POSTED',$8::bigint)
         RETURNING id::text`,
        [docNo, vendorId, paymentDate, fromSatang(grossS), fromSatang(whtTotalS), fromSatang(netS), bankAccountId, user.id]
      )
      const paymentId = pay.rows[0].id as string

      const WHT_ACCOUNT: Record<string, string> = {
        PND1: '2200', PND2: '2201', PND3: '2201', PND53: '2202', PND54: '2202',
      }

      const lines: JeLine[] = [
        {
          code: '2000', dr: fromSatang(grossS), partner_id: vendorId,
          ref: details.map((d) => d.docNo).join(', '), memo: 'ตัดเจ้าหนี้การค้า',
        },
      ]
      for (const [form, amt] of whtByForm) {
        lines.push({
          code: WHT_ACCOUNT[form] ?? '2202', cr: fromSatang(amt),
          memo: `ภาษีหัก ณ ที่จ่ายค้างนำส่ง (${form})`,
        })
      }
      lines.push({ code: bankCode, cr: fromSatang(netS), memo: 'จ่ายเงินจริง' })
      if (vatTransferS > 0) {
        lines.push({ code: '1150', dr: fromSatang(vatTransferS), memo: 'ภาษีซื้อใช้สิทธิได้แล้ว' })
        lines.push({ code: '1151', cr: fromSatang(vatTransferS), memo: 'ล้างพักภาษีซื้อ' })
      }

      const jeNo = await nextDocNo(c, 'JV', paymentDate)
      const jeId = await postJournal(c, {
        entryNo: jeNo, date: paymentDate, source: 'PURCHASE_PAYMENT',
        description: `จ่ายชำระ ${docNo}`,
        lines, createdBy: user.id, approvedBy,
        sourceTable: 'ap_payments', sourceDocId: paymentId,
      })

      await c.query(`UPDATE acc.ap_payments SET journal_entry_id = $1::bigint WHERE id = $2::bigint`, [jeId, paymentId])

      const vendor = await c.query(
        `SELECT partner_name, tax_id, branch_code FROM acc.business_partners WHERE id = $1::bigint`,
        [vendorId]
      )

      for (const d of details) {
        await c.query(
          `INSERT INTO acc.ap_payment_allocations (payment_id, bill_id, applied_amount, wht_amount)
           VALUES ($1::bigint,$2::bigint,$3,$4)`,
          [paymentId, d.billId, fromSatang(d.appliedS), fromSatang(d.whtS)]
        )

        await c.query(
          `UPDATE acc.ap_bills
              SET paid_amount = paid_amount + $2,
                  balance_due = balance_due - $2,
                  status = CASE WHEN balance_due - $2 <= 0 THEN 'PAID'::acc.doc_status
                                ELSE 'PARTIAL_PAID'::acc.doc_status END
            WHERE id = $1::bigint`,
          [d.billId, fromSatang(d.appliedS)]
        )

        if (d.whtS > 0) {
          const wtNo = await nextDocNo(c, 'WHT', paymentDate)
          await c.query(
            `INSERT INTO acc.wht_certificates
               (doc_no, payment_id, payee_id, issue_date, period_id, wht_form, income_type,
                base_amount, wht_rate, wht_amount)
             VALUES ($1,$2::bigint,$3::bigint,$4::date,$5::bigint,$6::acc.wht_form,'40(8)',$7,$8,$9)`,
            [wtNo, paymentId, vendorId, paymentDate, periodId, d.whtForm, fromSatang(d.baseS), d.whtRate, fromSatang(d.whtS)]
          )
        }

        if (d.onPayment && d.vatPartS > 0) {
          const seq = await nextVatSeq(c, 'vat_input_items', periodId)
          await c.query(
            `INSERT INTO acc.vat_input_items
               (period_id, seq_no, tax_invoice_date, tax_invoice_no, vendor_name,
                vendor_tax_id, vendor_branch, base_amount, vat_amount, source_type, source_doc_id, journal_entry_id)
             VALUES ($1::bigint,$2,$3::date,$4,$5,$6,$7,$8,$9,'PURCHASE_PAYMENT',$10::bigint,$11::bigint)`,
            [
              periodId, seq, paymentDate, d.vendorInvoiceNo ?? d.docNo,
              vendor.rows[0]?.partner_name ?? '', vendor.rows[0]?.tax_id ?? null, vendor.rows[0]?.branch_code ?? null,
              fromSatang(d.baseS), fromSatang(d.vatPartS), paymentId, jeId,
            ]
          )
        }
      }

      return { id: paymentId, docNo }
    })

    revalidatePath('/payments')
    revalidatePath('/bills')
    revalidatePath('/')
    return { ok: true, ...result }
  } catch (err) {
    if (isFrameworkError(err)) throw err
    return { ok: false, error: dbErrorMessage(err) }
  }
}

// =====================================================================
// ลงบัญชีมือ (Manual Journal Entry)
// =====================================================================
export async function createManualEntry(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('journal.create')
    const entryDate = String(formData.get('entry_date') ?? '')
    const description = String(formData.get('description') ?? '').trim()
    const source = String(formData.get('source_type') ?? 'MANUAL')
    const rows = JSON.parse(String(formData.get('lines') ?? '[]')) as Array<{
      account_code: string; dr: string; cr: string; memo: string
    }>

    if (!description) return { ok: false, error: 'ต้องระบุคำอธิบายรายการ' }

    const lines: JeLine[] = rows
      .filter((r) => r.account_code && (toSatang(r.dr) > 0 || toSatang(r.cr) > 0))
      .map((r) => ({
        code: r.account_code,
        dr: toSatang(r.dr) > 0 ? fromSatang(toSatang(r.dr)) : undefined,
        cr: toSatang(r.cr) > 0 ? fromSatang(toSatang(r.cr)) : undefined,
        memo: r.memo || undefined,
      }))

    if (lines.length < 2) return { ok: false, error: 'ต้องมีอย่างน้อย 2 บรรทัดที่มีจำนวนเงิน' }

    const drTotal = lines.reduce((a, l) => a + toSatang(l.dr ?? 0), 0)
    const crTotal = lines.reduce((a, l) => a + toSatang(l.cr ?? 0), 0)
    if (drTotal !== crTotal) {
      return {
        ok: false,
        error: `เดบิตไม่เท่ากับเครดิต (ผลต่าง ${((drTotal - crTotal) / 100).toFixed(2)} บาท)`,
      }
    }

    const approvedBy = await findApprover(user.id)

    const result = await tx(user.username, async (c) => {
      const jeNo = await nextDocNo(c, 'JV', entryDate)
      const id = await postJournal(c, {
        entryNo: jeNo, date: entryDate, source, description,
        lines, createdBy: user.id, approvedBy,
      })
      return { id, docNo: jeNo }
    })

    revalidatePath('/journal')
    revalidatePath('/')
    return { ok: true, ...result }
  } catch (err) {
    if (isFrameworkError(err)) throw err
    return { ok: false, error: dbErrorMessage(err) }
  }
}

// =====================================================================
// กลับรายการ (วิธีเดียวที่ยกเลิกใบที่ POSTED แล้วได้)
// =====================================================================
export async function reverseEntry(entryId: string, reason: string): Promise<ActionResult> {
  try {
    const user = await requirePermission('journal.reverse')
    const approvedBy = await findApprover(user.id)

    const result = await tx(user.username, async (c) => {
      const src = await c.query(
        `SELECT entry_no, entry_date::text FROM acc.journal_entries WHERE id = $1::bigint`,
        [entryId]
      )
      if (!src.rows[0]) throw new Error('ไม่พบรายการบัญชี')

      // งวดเดิมอาจปิดไปแล้ว — ถ้าปิดแล้วให้ลงวันแรกของงวดที่เปิดอยู่ปัจจุบันแทน
      const openDate = await c.query(
        `SELECT CASE WHEN p.status = 'OPEN' THEN $1::date
                     ELSE (SELECT start_date FROM acc.accounting_periods
                            WHERE status = 'OPEN' AND start_date >= p.start_date
                            ORDER BY start_date LIMIT 1)
                END::text AS d
           FROM acc.accounting_periods p
          WHERE $1::date BETWEEN p.start_date AND p.end_date`,
        [src.rows[0].entry_date]
      )
      const revDate = openDate.rows[0]?.d
      if (!revDate) throw new Error('ไม่พบงวดบัญชีที่เปิดอยู่สำหรับบันทึกใบกลับบัญชี')

      const jeNo = await nextDocNo(c, 'JV', revDate)
      const r = await c.query(
        `SELECT acc.reverse_journal_entry($1::bigint,$2,$3::date,$4::bigint,$5::bigint,$6) AS id`,
        [entryId, jeNo, revDate, user.id, approvedBy, reason || null]
      )
      return { id: r.rows[0].id as string, docNo: jeNo }
    })

    revalidatePath('/journal')
    revalidatePath('/')
    return { ok: true, ...result }
  } catch (err) {
    if (isFrameworkError(err)) throw err
    return { ok: false, error: dbErrorMessage(err) }
  }
}

// =====================================================================
// ปิดงวดบัญชี
// =====================================================================
export async function closePeriod(periodId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await requirePermission('period.close')
    await tx(user.username, async (c) => {
      await c.query(`SELECT acc.close_period($1::bigint, $2::bigint)`, [periodId, user.id])
    })
    revalidatePath('/periods')
    revalidatePath('/')
    return { ok: true }
  } catch (err) {
    if (isFrameworkError(err)) throw err
    return { ok: false, error: dbErrorMessage(err) }
  }
}
