'use client'

import { saveAccount } from '@/lib/master'
import { CrudForm, Collapsible } from './CrudPanel'

const TYPES = [
  ['ASSET', 'สินทรัพย์'],
  ['LIABILITY', 'หนี้สิน'],
  ['EQUITY', 'ส่วนของผู้ถือหุ้น'],
  ['REVENUE', 'รายได้'],
  ['EXPENSE', 'ค่าใช้จ่าย'],
] as const

const CASHFLOW = [
  ['NONE', 'ไม่เกี่ยวกับกระแสเงินสด'],
  ['CASH', 'เงินสดและรายการเทียบเท่า'],
  ['OPERATING', 'กิจกรรมดำเนินงาน'],
  ['INVESTING', 'กิจกรรมลงทุน'],
  ['FINANCING', 'กิจกรรมจัดหาเงิน'],
] as const

export default function AccountForm({ open }: { open?: boolean }) {
  return (
    <Collapsible label="+ เพิ่มบัญชีใหม่" defaultOpen={open}>
      <CrudForm action={saveAccount} submitLabel="เพิ่มบัญชี">
        <div className="row">
          <div className="field">
            <label>รหัสบัญชี *</label>
            <input type="text" name="account_code" inputMode="numeric" required placeholder="เช่น 4030" />
            <div className="hint">
              1xxx สินทรัพย์ · 2xxx หนี้สิน · 3xxx ทุน · 4xxx รายได้ · 5xxx ค่าใช้จ่าย
            </div>
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label>ชื่อบัญชี *</label>
            <input type="text" name="account_name" required />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>ประเภทบัญชี *</label>
            <select name="account_type" required defaultValue="EXPENSE">
              {TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <div className="hint">ระบบกำหนดด้านปกติ (เดบิต/เครดิต) ให้อัตโนมัติตามประเภท</div>
          </div>
          <div className="field">
            <label>กลุ่มย่อย</label>
            <input type="text" name="account_subtype" placeholder="เช่น SGA, CURRENT_ASSET" />
          </div>
          <div className="field">
            <label>กลุ่มกระแสเงินสด</label>
            <select name="cashflow_category" defaultValue="OPERATING">
              {CASHFLOW.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <div className="hint">เลือก “เงินสดและรายการเทียบเท่า” ถ้าจะผูกกับบัญชีธนาคาร</div>
          </div>
        </div>

        <div className="field">
          <label>บรรทัดในงบการเงิน</label>
          <input type="text" name="npae_report_line"
            placeholder="เช่น ค่าใช้จ่ายในการบริหาร" />
          <div className="hint">ใช้จัดกลุ่มตอนออกงบกำไรขาดทุนและงบแสดงฐานะการเงิน</div>
        </div>

        <div className="field">
          <label>คุณสมบัติ</label>
          <label className="check-line">
            <input type="checkbox" name="allow_posting" defaultChecked />
            <span>
              <strong>ลงรายการได้โดยตรง</strong>
              <span className="muted" style={{ fontSize: 12, display: 'block' }}>
                ถ้าไม่ติ๊ก จะเป็นบัญชีหัวข้อ/บัญชีคุมที่ใช้จัดกลุ่มเท่านั้น ระบบจะปฏิเสธการลงรายการ
              </span>
            </span>
          </label>
          <label className="check-line">
            <input type="checkbox" name="is_contra" />
            <span>
              <strong>เป็นบัญชีปรับมูลค่า</strong>
              <span className="muted" style={{ fontSize: 12, display: 'block' }}>
                เช่น ค่าเสื่อมราคาสะสม ค่าเผื่อหนี้สงสัยจะสูญ — ยอดจะอยู่ด้านตรงข้ามกับกลุ่มของตัวเอง
              </span>
            </span>
          </label>
        </div>
      </CrudForm>
    </Collapsible>
  )
}
