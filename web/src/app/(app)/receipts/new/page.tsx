import ReceiptForm, { type OpenInvoice } from '@/components/ReceiptForm'
import { requireUser, can } from '@/lib/auth'
import NoPermission from '@/components/NoPermission'
import { q } from '@/lib/db'
import { customers, bankAccounts } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default async function NewReceiptPage() {
  const me = await requireUser()
  if (!can(me, 'doc.create')) {
    return <NoPermission action="บันทึกรับชำระเงิน" roles={me.roles} allowed={['CONTROLLER','SENIOR_ACCOUNTANT','AR_AP_CLERK']} />
  }

  const [cust, banks, invoices] = await Promise.all([
    customers(),
    bankAccounts(),
    q<OpenInvoice>(`
      SELECT id::text, doc_no, customer_id::text, issue_date::text, due_date::text,
             total_amount::text, vat_amount::text, balance_due::text, expected_wht_rate::text
        FROM acc.ar_invoices
       WHERE balance_due > 0 AND status NOT IN ('DRAFT','CANCELLED')
       ORDER BY due_date`),
  ])

  if (banks.length === 0) {
    return (
      <>
        <div className="page-head"><div><h1>รับชำระเงิน</h1></div></div>
        <div className="alert warn">
          <div>ยังไม่มีบัญชีธนาคารในระบบ — ต้องเพิ่มในตาราง bank_accounts ก่อน</div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>รับชำระเงิน</h1>
          <p>กฎ R-2 — Dr ธนาคาร + ภาษีถูกหัก ณ ที่จ่าย / Cr ลูกหนี้ พร้อมโอนพักภาษีขายเข้าภาษีขาย</p>
        </div>
      </div>
      <ReceiptForm customers={cust} openInvoices={invoices} banks={banks} />
    </>
  )
}
