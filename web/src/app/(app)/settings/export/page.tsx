import { requireUser, can } from '@/lib/auth'
import { listTargets, listSyncLog, getCronToken } from '@/lib/exporting'
import { buildReports } from '@/lib/reports'
import NoPermission from '@/components/NoPermission'
import ExportPanel from '@/components/ExportPanel'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'ส่งข้อมูลให้นักบัญชี · ระบบบัญชี' }

export default async function ExportPage() {
  const me = await requireUser()
  if (!can(me, 'coa.manage')) {
    return <NoPermission action="ตั้งค่าการส่งข้อมูลให้นักบัญชี" roles={me.roles} allowed={['CONTROLLER']} />
  }

  const [targets, log, token, preview] = await Promise.all([
    listTargets(),
    listSyncLog(),
    getCronToken(),
    buildReports({ wholeYear: true }),
  ])

  const summary = preview.reports.map((r) => ({
    key: r.key,
    sheetName: r.sheetName,
    title: r.title,
    description: r.description,
    rows: r.rows.length,
  }))

  return (
    <ExportPanel
      targets={targets}
      log={log}
      cronToken={token}
      summary={summary}
      rangeLabel={preview.range.label}
    />
  )
}
