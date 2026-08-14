import type { NextConfig } from 'next'

// เมื่อเปิดผ่าน tunnel หรือ reverse proxy ที่เปลี่ยนค่า Host
// ต้องบอก Next ว่าโดเมนไหนเรียก server action ได้ มิฉะนั้นการกดปุ่มบันทึกจะถูกปฏิเสธ
// ตั้งค่าเป็นรายการคั่นด้วยจุลภาค เช่น ALLOWED_ORIGINS=demo.example.com,192.168.1.27:3100
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg'],
  // จำเป็นสำหรับ Docker image แบบ standalone
  output: 'standalone',
  ...(allowedOrigins.length > 0
    ? { experimental: { serverActions: { allowedOrigins } } }
    : {}),
}

export default nextConfig
