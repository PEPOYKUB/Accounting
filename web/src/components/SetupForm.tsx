'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { runFirstSetup } from '@/lib/master'

export default function SetupForm({ defaultFiscalYearStart }: { defaultFiscalYearStart: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(1)

  const [company, setCompany] = useState('')
  const [taxId, setTaxId] = useState('')
  const [branch, setBranch] = useState('00000')
  const [address, setAddress] = useState('')
  const [fyStart, setFyStart] = useState(defaultFiscalYearStart)

  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const step1Ok = company.trim() !== '' && fyStart !== ''
  const pwProblem =
    password.length > 0 && password.length < 8
      ? 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'
      : password && !/[A-Za-z]/.test(password)
        ? 'ต้องมีตัวอักษรอย่างน้อย 1 ตัว'
        : password && !/[0-9]/.test(password)
          ? 'ต้องมีตัวเลขอย่างน้อย 1 ตัว'
          : confirm && password !== confirm
            ? 'รหัสผ่านทั้งสองช่องไม่ตรงกัน'
            : null
  const step2Ok = username.trim() !== '' && fullName.trim() !== '' && password !== '' && !pwProblem && password === confirm

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('company_name', company)
    fd.set('company_tax_id', taxId)
    fd.set('company_branch_code', branch)
    fd.set('company_address', address)
    fd.set('fiscal_year_start', fyStart)
    fd.set('username', username)
    fd.set('full_name', fullName)
    fd.set('email', email)
    fd.set('password', password)
    fd.set('confirm_password', confirm)

    start(async () => {
      const res = await runFirstSetup(fd)
      if (res.ok) router.push('/login?setup=1')
      else setError(res.error)
    })
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <div className="auth-brand">
          <div className="auth-logo">฿</div>
          <div>
            <h1>ติดตั้งระบบครั้งแรก</h1>
            <p>ตั้งค่าข้อมูลกิจการและสร้างผู้ดูแลระบบคนแรก · ทำครั้งเดียว</p>
          </div>
        </div>

        <div className="steps">
          <span className={step >= 1 ? 'active' : ''}>1 · ข้อมูลกิจการ</span>
          <span className={step >= 2 ? 'active' : ''}>2 · ผู้ดูแลระบบ</span>
        </div>

        {error && <div className="alert err"><div>{error}</div></div>}

        {step === 1 && (
          <>
            <div className="field">
              <label>ชื่อกิจการ *</label>
              <input type="text" value={company} onChange={(e) => setCompany(e.target.value)}
                placeholder="เช่น บริษัท ตัวอย่าง จำกัด" autoFocus />
            </div>
            <div className="row">
              <div className="field">
                <label>เลขประจำตัวผู้เสียภาษี</label>
                <input type="text" inputMode="numeric" value={taxId} maxLength={13}
                  onChange={(e) => setTaxId(e.target.value.replace(/\D/g, ''))}
                  placeholder="13 หลัก" />
              </div>
              <div className="field">
                <label>รหัสสาขา</label>
                <input type="text" inputMode="numeric" value={branch} maxLength={5}
                  onChange={(e) => setBranch(e.target.value.replace(/\D/g, ''))} />
                <div className="hint">สำนักงานใหญ่ใช้ 00000</div>
              </div>
            </div>
            <div className="field">
              <label>ที่อยู่ตามที่จดทะเบียน</label>
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)}
                placeholder="ใช้พิมพ์บนใบกำกับภาษี" />
            </div>
            <div className="field">
              <label>วันเริ่มต้นปีบัญชี *</label>
              <input type="date" value={fyStart} onChange={(e) => setFyStart(e.target.value)} />
              <div className="hint">
                ระบบจะสร้างงวดบัญชี 12 งวดให้อัตโนมัติ · รอบบัญชีไม่ตรงปีปฏิทินก็ได้
              </div>
            </div>

            <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn primary" disabled={!step1Ok}
                onClick={() => setStep(2)}>ถัดไป</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="alert info">
              <div>
                บัญชีนี้จะได้บทบาท <strong>ผู้จัดการบัญชี</strong> ซึ่งทำได้ทุกอย่างรวมถึงเพิ่มผู้ใช้คนอื่น
              </div>
            </div>

            <div className="field">
              <label>ชื่อผู้ใช้ *</label>
              <input type="text" value={username} autoCapitalize="none"
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="เช่น admin" autoFocus />
              <div className="hint">ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3-32 ตัว</div>
            </div>
            <div className="field">
              <label>ชื่อ-นามสกุล *</label>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="field">
              <label>อีเมล</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label>รหัสผ่าน *</label>
              <input type="password" value={password} autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)} />
              <div className="hint">อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข</div>
            </div>
            <div className="field">
              <label>ยืนยันรหัสผ่าน *</label>
              <input type="password" value={confirm} autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)} />
              {pwProblem && <div className="hint" style={{ color: 'var(--danger)' }}>{pwProblem}</div>}
            </div>

            <div className="alert warn">
              <div>
                <strong>จดรหัสผ่านไว้ให้ดี</strong> — ระบบยังไม่มีฟังก์ชันลืมรหัสผ่าน
                ถ้าลืมต้องให้ผู้ดูแลระบบตั้งใหม่ให้ผ่านฐานข้อมูล
              </div>
            </div>

            <div className="toolbar form-actions" style={{ justifyContent: 'space-between', marginTop: 16 }}>
              <button type="button" className="btn" onClick={() => setStep(1)} disabled={pending}>ย้อนกลับ</button>
              <button type="button" className="btn primary" onClick={submit} disabled={pending || !step2Ok}>
                {pending ? 'กำลังติดตั้ง…' : 'ติดตั้งและเริ่มใช้งาน'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
