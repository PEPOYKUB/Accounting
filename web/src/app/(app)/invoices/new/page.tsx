import InvoiceForm from '@/components/InvoiceForm'
import { requireUser, can } from '@/lib/auth'
import NoPermission from '@/components/NoPermission'
import { customers, accountsOfType, costCenters } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default async function NewInvoicePage() {
  const me = await requireUser()
  if (!can(me, 'doc.create')) {
    return <NoPermission action="ออกใบแจ้งหนี้" roles={me.roles} allowed={['CONTROLLER','SENIOR_ACCOUNTANT','AR_AP_CLERK']} />
  }

  const [cust, accts, cc] = await Promise.all([
    customers(),
    accountsOfType(['REVENUE']),
    costCenters(),
  ])

  if (cust.length === 0) {
    return (
      <>
        <div className="page-head"><div><h1>ออกใบแจ้งหนี้</h1></div></div>
        <div className="alert warn">
          <div>ยังไม่มีลูกค้าในระบบ — ต้องเพิ่มข้อมูลลูกค้าในตาราง business_partners ก่อน</div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ออกใบแจ้งหนี้</h1>
          <p>ลงบัญชีอัตโนมัติตามกฎ R-1 — Dr ลูกหนี้การค้า / Cr รายได้ + พักภาษีขาย</p>
        </div>
      </div>
      <InvoiceForm customers={cust} revenueAccounts={accts} costCenters={cc} />
    </>
  )
}
