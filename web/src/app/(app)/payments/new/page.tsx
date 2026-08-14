import PaymentForm, { type OpenBill } from '@/components/PaymentForm'
import { requireUser, can } from '@/lib/auth'
import NoPermission from '@/components/NoPermission'
import { q } from '@/lib/db'
import { vendors, bankAccounts } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default async function NewPaymentPage() {
  const me = await requireUser()
  if (!can(me, 'doc.create')) {
    return <NoPermission action="บันทึกจ่ายชำระ" roles={me.roles} allowed={['CONTROLLER','SENIOR_ACCOUNTANT','AR_AP_CLERK']} />
  }

  const [vend, banks, bills] = await Promise.all([
    vendors(),
    bankAccounts(),
    q<OpenBill>(`
      SELECT id::text, doc_no, vendor_id::text, bill_date::text, due_date::text,
             total_amount::text, vat_amount::text, balance_due::text,
             wht_rate::text, wht_form::text, vat_timing::text
        FROM acc.ap_bills
       WHERE balance_due > 0 AND status NOT IN ('DRAFT','CANCELLED')
       ORDER BY due_date`),
  ])

  if (banks.length === 0) {
    return (
      <>
        <div className="page-head"><div><h1>จ่ายชำระ</h1></div></div>
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
          <h1>จ่ายชำระเจ้าหนี้</h1>
          <p>กฎ P-3 — Dr เจ้าหนี้ / Cr ภาษีหัก ณ ที่จ่ายค้างนำส่ง + ธนาคาร พร้อมโอนพักภาษีซื้อ</p>
        </div>
      </div>
      <PaymentForm vendors={vend} openBills={bills} banks={banks} />
    </>
  )
}
