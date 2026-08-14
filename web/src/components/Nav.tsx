'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

type Item = { href: string; label: string; ico: string }

export type NavPerms = {
  canCreateDoc: boolean
  canJournal: boolean
  canClosePeriod: boolean
  canManageMaster: boolean
  canManageUsers: boolean
}

export const NAV_GROUPS: { title: string; items: Item[] }[] = [
  { title: 'ภาพรวม', items: [{ href: '/', label: 'แดชบอร์ด', ico: '◍' }] },
  {
    title: 'รายรับ',
    items: [
      { href: '/invoices', label: 'ใบแจ้งหนี้', ico: '▤' },
      { href: '/receipts', label: 'รับชำระเงิน', ico: '▼' },
    ],
  },
  {
    title: 'รายจ่าย',
    items: [
      { href: '/bills', label: 'ตั้งหนี้ผู้ขาย', ico: '▥' },
      { href: '/payments', label: 'จ่ายชำระ', ico: '▲' },
    ],
  },
  {
    title: 'บัญชี',
    items: [
      { href: '/journal', label: 'สมุดรายวัน', ico: '≡' },
      { href: '/accounts', label: 'ผังบัญชี', ico: '⊞' },
      { href: '/periods', label: 'งวดบัญชี', ico: '◷' },
    ],
  },
  {
    title: 'รายงาน',
    items: [
      { href: '/reports/trial-balance', label: 'งบทดลอง', ico: '⊟' },
      { href: '/reports/income-statement', label: 'งบกำไรขาดทุน', ico: '↗' },
      { href: '/reports/balance-sheet', label: 'งบแสดงฐานะการเงิน', ico: '⚖' },
      { href: '/reports/ar-aging', label: 'อายุลูกหนี้', ico: '◔' },
      { href: '/reports/vat', label: 'รายงานภาษี', ico: '%' },
    ],
  },
]

function isActive(path: string, href: string) {
  return href === '/' ? path === '/' : path.startsWith(href)
}

export default function Nav({
  perms,
  open,
  onClose,
}: {
  perms: NavPerms
  open: boolean
  onClose: () => void
}) {
  const path = usePathname()

  // ปิดลิ้นชักอัตโนมัติเมื่อเปลี่ยนหน้า มิฉะนั้นบนมือถือจะค้างบังเนื้อหา
  useEffect(() => { onClose() }, [path])   // eslint-disable-line react-hooks/exhaustive-deps

  // ล็อกไม่ให้หน้าเลื่อนตอนลิ้นชักเปิด
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  const settingsItems: Item[] = [
    ...(perms.canCreateDoc ? [{ href: '/settings/partners', label: 'ลูกค้าและผู้ขาย', ico: '☺' }] : []),
    ...(perms.canManageMaster
      ? [
          { href: '/settings/banks', label: 'บัญชีธนาคาร', ico: '฿' },
          { href: '/settings/cost-centers', label: 'ศูนย์ต้นทุน', ico: '◇' },
          { href: '/settings/export', label: 'ส่งข้อมูลให้นักบัญชี', ico: '↗' },
          { href: '/settings/company', label: 'ตั้งค่ากิจการ', ico: '⚙' },
        ]
      : []),
    ...(perms.canManageUsers ? [{ href: '/settings/users', label: 'ผู้ใช้งาน', ico: '⚇' }] : []),
  ]

  return (
    <>
      {open && (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="ปิดเมนู"
          onClick={onClose}
        />
      )}

      <nav className={`sidebar${open ? ' open' : ''}`} aria-label="เมนูหลัก">
        <div className="brand">
          ระบบบัญชี
          <small>ธุรกิจบริการ · TFRS for NPAEs</small>
        </div>

        {NAV_GROUPS.map((g) => (
          <div className="nav-group" key={g.title}>
            <span>{g.title}</span>
            {g.items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className={`nav-link${isActive(path, it.href) ? ' active' : ''}`}
              >
                <span className="ico">{it.ico}</span>
                {it.label}
              </Link>
            ))}
          </div>
        ))}

        {settingsItems.length > 0 && (
          <div className="nav-group">
            <span>ตั้งค่า</span>
            {settingsItems.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className={`nav-link${isActive(path, it.href) ? ' active' : ''}`}
              >
                <span className="ico">{it.ico}</span>
                {it.label}
              </Link>
            ))}
          </div>
        )}

        {(perms.canCreateDoc || perms.canJournal) && (
          <div className="nav-group">
            <span>สร้างใหม่</span>
            {perms.canCreateDoc && (
              <>
                <Link href="/invoices/new" className="nav-link">
                  <span className="ico">+</span>ออกใบแจ้งหนี้
                </Link>
                <Link href="/receipts/new" className="nav-link">
                  <span className="ico">+</span>รับชำระเงิน
                </Link>
                <Link href="/bills/new" className="nav-link">
                  <span className="ico">+</span>ตั้งหนี้ผู้ขาย
                </Link>
                <Link href="/payments/new" className="nav-link">
                  <span className="ico">+</span>จ่ายชำระ
                </Link>
              </>
            )}
            {perms.canJournal && (
              <Link href="/journal/new" className="nav-link">
                <span className="ico">+</span>ลงบัญชีมือ
              </Link>
            )}
          </div>
        )}
      </nav>
    </>
  )
}

/** แถบเมนูล่างแบบแอปมือถือ — แสดงเฉพาะจอเล็ก */
export function TabBar({ perms }: { perms: NavPerms }) {
  const path = usePathname()

  const tabs: Item[] = [
    { href: '/', label: 'หน้าหลัก', ico: '◍' },
    { href: '/invoices', label: 'ใบแจ้งหนี้', ico: '▤' },
    ...(perms.canCreateDoc
      ? [{ href: '/receipts/new', label: 'รับเงิน', ico: '＋' }]
      : []),
    { href: '/bills', label: 'รายจ่าย', ico: '▥' },
    { href: '/reports/trial-balance', label: 'รายงาน', ico: '⊟' },
  ]

  return (
    <nav className="tabbar" aria-label="เมนูด่วน">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={isActive(path, t.href) ? 'active' : ''}
        >
          <span className="ico">{t.ico}</span>
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
