import BillForm from '@/components/BillForm'
import { requireUser, can } from '@/lib/auth'
import NoPermission from '@/components/NoPermission'
import { vendors, accountsOfType, costCenters } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default async function NewBillPage() {
  const me = await requireUser()
  if (!can(me, 'doc.create')) {
    return <NoPermission action="ตั้งหนี้ผู้ขาย" roles={me.roles} allowed={['CONTROLLER','SENIOR_ACCOUNTANT','AR_AP_CLERK']} />
  }

  const [vend, accts, cc] = await Promise.all([
    vendors(),
    accountsOfType(['EXPENSE', 'ASSET']),
    costCenters(),
  ])

  if (vend.length === 0) {
    return (
      <>
        <div className="page-head"><div><h1>ตั้งหนี้ผู้ขาย</h1></div></div>
        <div className="alert warn">
          <div>ยังไม่มีผู้ขายในระบบ — ต้องเพิ่มข้อมูลผู้ขายในตาราง business_partners ก่อน</div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ตั้งหนี้ผู้ขาย</h1>
          <p>กฎ P-1 — Dr ค่าใช้จ่าย + ภาษีซื้อ(หรือพักภาษีซื้อ) / Cr เจ้าหนี้เต็มจำนวน</p>
        </div>
      </div>
      <BillForm vendors={vend} expenseAccounts={accts} costCenters={cc} />
    </>
  )
}
