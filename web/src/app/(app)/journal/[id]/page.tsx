import Link from 'next/link'
import { notFound } from 'next/navigation'
import { q, one } from '@/lib/db'
import { baht, thaiDate, thaiPeriod } from '@/lib/money'
import { SOURCE_TH } from '@/lib/labels'
import ReverseButton from '@/components/ReverseButton'
import { requireUser, can } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function JournalDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await requireUser()

  const je = await one<{
    id: string; entry_no: string; entry_date: string; period_name: string; period_status: string
    source_type: string; source_table: string | null; source_doc_id: string | null
    description: string; status: string; posted_at: string | null
    created_by_name: string; approved_by_name: string | null
    reverses_entry_no: string | null; reverses_entry_id: string | null
    reversed_by_entry_no: string | null; reversed_by_entry_id: string | null
  }>(
    `SELECT je.id::text, je.entry_no, je.entry_date::text, p.period_name, p.status::text AS period_status,
            je.source_type::text, je.source_table, je.source_doc_id::text,
            je.description, je.status::text, je.posted_at::text,
            cu.full_name AS created_by_name, au.full_name AS approved_by_name,
            r1.entry_no AS reverses_entry_no, je.reverses_entry_id::text,
            r2.entry_no AS reversed_by_entry_no, je.reversed_by_entry_id::text
       FROM acc.journal_entries je
       JOIN acc.accounting_periods p ON p.id = je.period_id
       JOIN acc.app_users cu ON cu.id = je.created_by
       LEFT JOIN acc.app_users au ON au.id = je.approved_by
       LEFT JOIN acc.journal_entries r1 ON r1.id = je.reverses_entry_id
       LEFT JOIN acc.journal_entries r2 ON r2.id = je.reversed_by_entry_id
      WHERE je.id = $1::bigint`,
    [id]
  )

  if (!je) notFound()

  const lines = await q<{
    line_no: number; account_code: string; account_name: string
    debit_amount: string; credit_amount: string; description: string | null
    partner_name: string | null; cost_center_name: string | null; reference_doc: string | null
  }>(
    `SELECT l.line_no, a.account_code, a.account_name,
            l.debit_amount::text, l.credit_amount::text, l.description,
            bp.partner_name, cc.name AS cost_center_name, l.reference_doc
       FROM acc.journal_entry_lines l
       JOIN acc.chart_of_accounts a ON a.id = l.account_id
       LEFT JOIN acc.business_partners bp ON bp.id = l.partner_id
       LEFT JOIN acc.cost_centers cc ON cc.id = l.cost_center_id
      WHERE l.journal_entry_id = $1::bigint
      ORDER BY l.line_no`,
    [id]
  )

  const totalDr = lines.reduce((a, l) => a + Number(l.debit_amount), 0)
  const totalCr = lines.reduce((a, l) => a + Number(l.credit_amount), 0)

  const SOURCE_LINK: Record<string, string> = {
    ar_invoices: '/invoices',
    ar_receipts: '/receipts',
    ap_bills: '/bills',
    ap_payments: '/payments',
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ใบสำคัญ {je.entry_no}</h1>
          <p>
            {thaiDate(je.entry_date)} · งวด {thaiPeriod(je.period_name)}{' '}
            <span className={`badge ${je.period_status === 'OPEN' ? 'ok' : 'plain'}`}>
              {je.period_status === 'OPEN' ? 'งวดเปิดอยู่' : 'งวดปิดแล้ว'}
            </span>
          </p>
        </div>
        <div className="toolbar">
          <Link className="btn" href="/journal">← กลับสมุดรายวัน</Link>
          {je.status === 'POSTED' && !je.reversed_by_entry_id && can(me, 'journal.reverse') && (
            <ReverseButton entryId={je.id} entryNo={je.entry_no} />
          )}
        </div>
      </div>

      {je.reversed_by_entry_id && (
        <div className="alert warn">
          <div>
            ใบนี้ถูกกลับรายการแล้วด้วยใบ{' '}
            <Link href={`/journal/${je.reversed_by_entry_id}`}>{je.reversed_by_entry_no}</Link>
          </div>
        </div>
      )}
      {je.reverses_entry_id && (
        <div className="alert info">
          <div>
            ใบนี้เป็นใบกลับรายการของ{' '}
            <Link href={`/journal/${je.reverses_entry_id}`}>{je.reverses_entry_no}</Link>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body">
          <div className="row">
            <div>
              <div className="muted" style={{ fontSize: 12 }}>ที่มา</div>
              <div>
                <span className="badge plain">{SOURCE_TH[je.source_type] ?? je.source_type}</span>
                {je.source_table && SOURCE_LINK[je.source_table] && (
                  <Link href={SOURCE_LINK[je.source_table]} style={{ marginLeft: 8, fontSize: 12 }}>
                    ดูเอกสารต้นทาง →
                  </Link>
                )}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>คำอธิบาย</div>
              <div>{je.description}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>ผู้บันทึก / ผู้อนุมัติ</div>
              <div>{je.created_by_name} / {je.approved_by_name ?? '—'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>สถานะ</div>
              <div>
                <span className={`badge ${je.status === 'POSTED' ? 'ok' : 'warn'}`}>
                  {je.status === 'POSTED' ? 'ลงบัญชีแล้ว (แก้ไขไม่ได้)' : 'ร่าง'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">บรรทัดรายการบัญชี</div>
        <div className="table-wrap">
          <table className="tbl cards">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>บัญชี</th>
                <th>คำอธิบาย</th>
                <th>คู่ค้า</th>
                <th>ศูนย์ต้นทุน</th>
                <th>อ้างอิง</th>
                <th className="num">เดบิต</th>
                <th className="num">เครดิต</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.line_no}>
                  <td data-label="#" className="muted">{l.line_no}</td>
                  <td data-label="บัญชี">
                    <span className="code">{l.account_code}</span> {l.account_name}
                  </td>
                  <td data-label="คำอธิบาย" className="muted">{l.description ?? '—'}</td>
                  <td data-label="คู่ค้า">{l.partner_name ?? <span className="muted">—</span>}</td>
                  <td data-label="ศูนย์ต้นทุน">{l.cost_center_name ?? <span className="muted">—</span>}</td>
                  <td data-label="อ้างอิง" className="code">{l.reference_doc ?? '—'}</td>
                  <td data-label="เดบิต" className="num">{Number(l.debit_amount) > 0 ? baht(l.debit_amount) : ''}</td>
                  <td data-label="เครดิต" className="num">{Number(l.credit_amount) > 0 ? baht(l.credit_amount) : ''}</td>
                </tr>
              ))}
              <tr className="total">
                <td colSpan={6}>รวม</td>
                <td className="num">{baht(totalDr)}</td>
                <td className="num">{baht(totalCr)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
          <span className={`badge ${totalDr === totalCr ? 'ok' : 'danger'}`}>
            {totalDr === totalCr ? '● เดบิตเท่ากับเครดิต' : '● ไม่สมดุล'}
          </span>
        </div>
      </div>
    </>
  )
}
