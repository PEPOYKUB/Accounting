// ทำให้ "เพิ่มลงหน้าจอโฮม" บนมือถือได้ ใช้งานเหมือนแอปจริง
export const dynamic = 'force-static'

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#1f6feb"/>
  <text x="256" y="360" font-family="system-ui, sans-serif" font-size="300"
        font-weight="700" fill="#ffffff" text-anchor="middle">฿</text>
</svg>`

export function GET() {
  const manifest = {
    name: 'ระบบบัญชี',
    short_name: 'บัญชี',
    description: 'ระบบบัญชีคู่เต็มรูปแบบสำหรับธุรกิจบริการ',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#f6f7f9',
    theme_color: '#1f6feb',
    lang: 'th',
    dir: 'ltr',
    icons: [
      {
        src: 'data:image/svg+xml;base64,' + Buffer.from(ICON).toString('base64'),
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  }

  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  })
}
