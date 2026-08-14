'use client'

import { createFiscalYear } from '@/lib/master'
import { CrudForm, Collapsible } from './CrudPanel'

export default function FiscalYearForm({
  suggestedStart,
  suggestedCode,
  open,
}: {
  suggestedStart: string
  suggestedCode: string
  open?: boolean
}) {
  return (
    <Collapsible label="+ สร้างปีบัญชีใหม่" defaultOpen={open}>
      <CrudForm action={createFiscalYear} submitLabel="สร้างปีบัญชีและ 12 งวด">
        <div className="row">
          <div className="field">
            <label>ชื่อปีบัญชี *</label>
            <input type="text" name="year_code" required defaultValue={suggestedCode} />
          </div>
          <div className="field">
            <label>วันเริ่มต้นปีบัญชี *</label>
            <input type="date" name="start_date" required defaultValue={suggestedStart} />
          </div>
        </div>
        <div className="alert info">
          <div>
            ระบบจะสร้างงวดบัญชี 12 งวดต่อเนื่องจากวันเริ่มต้นให้อัตโนมัติ
            รอบบัญชีไม่ตรงปีปฏิทินก็ได้ · งวดใหม่จะซ้อนทับกับงวดเดิมไม่ได้ ระบบจะปฏิเสธเอง
          </div>
        </div>
      </CrudForm>
    </Collapsible>
  )
}
