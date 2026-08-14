import { q } from '@/lib/db'
import { requireUser, can } from '@/lib/auth'
import { saveCostCenter, toggleCostCenter } from '@/lib/master'
import { CrudForm, ToggleButton, Collapsible } from '@/components/CrudPanel'
import NoPermission from '@/components/NoPermission'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'ศูนย์ต้นทุน · ระบบบัญชี' }

export default async function CostCentersPage() {
  const me = await requireUser()
  if (!can(me, 'coa.manage')) {
    return <NoPermission action="จัดการศูนย์ต้นทุน" roles={me.roles} allowed={['CONTROLLER']} />
  }

  const rows = await q<{ id: string; code: string; name: string; is_active: boolean; used: string }>(`
    SELECT c.id::text, c.code, c.name, c.is_active,
           (SELECT COUNT(*) FROM acc.journal_entry_lines l WHERE l.cost_center_id = c.id)::text AS used
      FROM acc.cost_centers c ORDER BY c.code`)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ศูนย์ต้นทุน</h1>
          <p>
            ใช้แยกรายได้และค่าใช้จ่ายตามแผนก โครงการ หรือสาขา · ไม่บังคับต้องมี
            แต่ถ้ามีจะดูกำไรแยกส่วนได้
          </p>
        </div>
      </div>

      <Collapsible label="+ เพิ่มศูนย์ต้นทุน" defaultOpen={rows.length === 0}>
        <CrudForm action={saveCostCenter} submitLabel="เพิ่ม">
          <div className="row">
            <div className="field">
              <label>รหัส *</label>
              <input type="text" name="code" required placeholder="เช่น CC01" />
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label>ชื่อ *</label>
              <input type="text" name="name" required placeholder="เช่น ฝ่ายที่ปรึกษา" />
            </div>
          </div>
        </CrudForm>
      </Collapsible>

      <div className="card">
        <div className="card-head">ทั้งหมด {rows.length} รายการ</div>
        <div className="table-wrap">
          {rows.length === 0 ? (
            <div className="empty">ยังไม่มีศูนย์ต้นทุน</div>
          ) : (
            <table className="tbl cards">
              <thead>
                <tr>
                  <th>รหัส</th>
                  <th>ชื่อ</th>
                  <th className="num">ใช้ไปแล้ว</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.5 }}>
                    <td data-label="รหัส" className="code card-title">{r.code}</td>
                    <td data-label="ชื่อ">{r.name}</td>
                    <td data-label="ใช้ไปแล้ว" className="num muted">{r.used} บรรทัด</td>
                    <td data-label="สถานะ">
                      <ToggleButton id={r.id} active={r.is_active} action={toggleCostCenter} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
