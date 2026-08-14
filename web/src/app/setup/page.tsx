import { redirect } from 'next/navigation'
import { isFirstRun } from '@/lib/master'
import SetupForm from '@/components/SetupForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'ติดตั้งระบบครั้งแรก · ระบบบัญชี' }

export default async function SetupPage() {
  // เข้าหน้านี้ได้เฉพาะตอนฐานข้อมูลยังไม่มีผู้ใช้เลย
  if (!(await isFirstRun())) redirect('/login')

  const today = new Date()
  const defaultFyStart = `${today.getFullYear()}-01-01`

  return <SetupForm defaultFiscalYearStart={defaultFyStart} />
}
