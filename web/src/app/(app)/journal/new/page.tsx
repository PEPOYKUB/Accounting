import ManualEntryForm from '@/components/ManualEntryForm'
import { requireUser, can } from '@/lib/auth'
import NoPermission from '@/components/NoPermission'
import { postableAccounts } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default async function NewJournalPage() {
  const me = await requireUser()
  if (!can(me, 'journal.create')) {
    return <NoPermission action="ลงบัญชีมือ" roles={me.roles} allowed={['CONTROLLER','SENIOR_ACCOUNTANT']} />
  }

  const accounts = await postableAccounts()

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ลงบัญชีมือ</h1>
          <p>
            ใช้กับรายการที่ไม่มีเอกสารต้นทางในระบบ เช่น ปรับปรุงสิ้นงวด นำส่งภาษี เงินเดือน
            ระบบยังคงบังคับ เดบิต = เครดิต และปฏิเสธถ้างวดบัญชีปิดแล้ว
          </p>
        </div>
      </div>
      <ManualEntryForm accounts={accounts} />
    </>
  )
}
