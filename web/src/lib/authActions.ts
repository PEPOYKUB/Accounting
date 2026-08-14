'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { login as doLogin, logout as doLogout, changePassword as doChange } from './auth'

export type FormState = { error?: string; ok?: boolean }

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const username = String(formData.get('username') ?? '')
  const password = String(formData.get('password') ?? '')

  let res: Awaited<ReturnType<typeof doLogin>>
  try {
    res = await doLogin(username, password)
  } catch (err) {
    // ข้อผิดพลาดที่ไม่คาดคิด (เช่น ต่อฐานข้อมูลไม่ได้) ต้องแสดงให้ผู้ใช้เห็น
    // ไม่ปล่อยให้กลายเป็นหน้า 500 เปล่า ๆ ที่ไม่บอกอะไร
    console.error('[login] ', err)
    return { error: 'เข้าสู่ระบบไม่สำเร็จเนื่องจากข้อผิดพลาดของระบบ กรุณาลองใหม่หรือติดต่อผู้ดูแล' }
  }

  if (!res.ok) return { error: res.error }
  redirect('/')
}

export async function logoutAction(): Promise<void> {
  await doLogout()
  redirect('/login')
}

export async function changePasswordAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const current = String(formData.get('current_password') ?? '')
  const next = String(formData.get('new_password') ?? '')
  const confirm = String(formData.get('confirm_password') ?? '')

  if (next !== confirm) return { error: 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน' }

  const res = await doChange(current, next)
  if (!res.ok) return { error: res.error }

  revalidatePath('/', 'layout')
  redirect('/?password_changed=1')
}
