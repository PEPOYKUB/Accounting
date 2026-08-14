'use client'

import { useRouter, usePathname } from 'next/navigation'
import { thaiPeriod } from '@/lib/money'
import type { Period } from '@/lib/queries'

export default function PeriodPicker({
  periods,
  selected,
}: {
  periods: Period[]
  selected: string
}) {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <div className="toolbar">
      <span className="muted" style={{ fontSize: 12 }}>งวดบัญชี</span>
      <select
        value={selected}
        onChange={(e) => router.push(`${pathname}?period=${e.target.value}`)}
        style={{ width: 'auto', minWidth: 180 }}
      >
        {periods.map((p) => (
          <option key={p.id} value={p.id}>
            {thaiPeriod(p.period_name)}
            {p.status !== 'OPEN' ? ' (ปิดแล้ว)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
