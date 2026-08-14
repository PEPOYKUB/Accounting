import type { Metadata, Viewport } from 'next'
import './globals.css'
import './mobile.css'

export const metadata: Metadata = {
  title: 'ระบบบัญชี',
  description: 'ระบบบัญชีคู่เต็มรูปแบบสำหรับธุรกิจบริการ',
  applicationName: 'ระบบบัญชี',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ระบบบัญชี',
  },
  formatDetection: {
    // กันไม่ให้ iOS เปลี่ยนเลขที่เอกสารและตัวเลขเงินเป็นลิงก์โทรออก
    telephone: false,
  },
}

/**
 * ขาดไม่ได้สำหรับมือถือ — ถ้าไม่มี viewport นี้ Safari และ Chrome บนมือถือ
 * จะเรนเดอร์หน้าที่ความกว้าง 980px แล้วย่อทั้งหน้าลง ทำให้ตัวหนังสือเล็กจนอ่านไม่ออก
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // ไม่ล็อกการซูม เพื่อให้ผู้ใช้ที่สายตาไม่ดีขยายอ่านตัวเลขได้
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1f24' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  )
}
