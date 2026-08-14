'use client'

import { useState } from 'react'
import Nav, { TabBar, type NavPerms } from './Nav'
import UserMenu from './UserMenu'
import type { AuthUser } from '@/lib/roles'

export default function AppShell({
  user,
  perms,
  health,
  children,
}: {
  user: AuthUser
  perms: NavPerms
  health: React.ReactNode
  children: React.ReactNode
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="shell">
      <Nav perms={perms} open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="burger"
            aria-label="เปิดเมนู"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((o) => !o)}
          >
            ☰
          </button>

          {health}

          <div className="spacer" />
          <UserMenu user={user} />
        </header>

        <div className="content">{children}</div>
      </div>

      <TabBar perms={perms} />
    </div>
  )
}
