'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveTarget, syncNow, toggleTarget, deleteTarget, type TargetRow } from '@/lib/exporting'
import { Collapsible } from './CrudPanel'

type Summary = { key: string; sheetName: string; title: string; description: string; rows: number }
type LogRow = {
  started_at: string; succeeded: boolean | null; rows_written: number | null
  range_label: string | null; message: string | null; triggered_by: string | null
}

export default function ExportPanel({
  targets,
  log,
  cronToken,
  summary,
  rangeLabel,
}: {
  targets: TargetRow[]
  log: LogRow[]
  cronToken: string | null
  summary: Summary[]
  rangeLabel: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [showToken, setShowToken] = useState(false)

  const totalRows = summary.reduce((a, s) => a + s.rows, 0)

  function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setMsg(null)
    start(async () => {
      const res = await fn()
      setMsg({ ok: res.ok, text: res.ok ? (res.message ?? 'สำเร็จ') : (res.error ?? 'ไม่สำเร็จ') })
      router.refresh()
    })
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ส่งข้อมูลให้นักบัญชี</h1>
          <p>
            ข้อมูล {rangeLabel} · {summary.length} รายงาน รวม {totalRows.toLocaleString('th-TH')} แถว
          </p>
        </div>
      </div>

      <div className="alert info">
        <div>
          <strong>ข้อมูลไหลทางเดียว</strong> — ระบบส่งออกไปให้ดูเท่านั้น
          ถ้านักบัญชีแก้ตัวเลขในไฟล์หรือใน Google Sheets จะ<u>ไม่</u>ย้อนกลับเข้าระบบ
          และจะถูกเขียนทับในการซิงก์รอบถัดไป · เจอที่ผิดให้แก้ในระบบด้วยการกลับรายการ
        </div>
      </div>

      {msg && (
        <div className={`alert ${msg.ok ? 'ok' : 'err'}`}>
          <div>{msg.text}</div>
        </div>
      )}

      {/* ───────── ดาวน์โหลดไฟล์ ───────── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <span>วิธีที่ 1 — ดาวน์โหลดไฟล์ (ใช้ได้ทันที)</span>
          <a className="btn primary sm" href="/api/export/download?format=xlsx&year=1">
            ดาวน์โหลด Excel ทุกรายงาน
          </a>
        </div>
        <div className="card-body">
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            ได้ไฟล์เดียวมีครบทุกแท็บ ส่งให้นักบัญชีทางอีเมลได้เลย ·
            หรืออัปโหลดขึ้น Google Drive แล้วเปิดด้วย Google Sheets จะได้ครบทุกแท็บเช่นกัน
          </p>
          <div className="table-wrap">
            <table className="tbl cards">
              <thead>
                <tr>
                  <th>รายงาน</th>
                  <th>ใช้ทำอะไร</th>
                  <th className="num">จำนวนแถว</th>
                  <th>แยกไฟล์</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.key}>
                    <td data-label="รายงาน" className="card-title">{s.title}</td>
                    <td data-label="ใช้ทำอะไร" className="muted" style={{ fontSize: 12.5 }}>
                      {s.description}
                    </td>
                    <td data-label="จำนวนแถว" className="num">{s.rows.toLocaleString('th-TH')}</td>
                    <td data-label="แยกไฟล์">
                      <a className="btn sm" href={`/api/export/download?format=csv&year=1&key=${s.key}`}>
                        CSV
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ───────── ซิงก์เข้า Google Sheets ───────── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">วิธีที่ 2 — ซิงก์เข้า Google Sheets อัตโนมัติ</div>
        <div className="table-wrap">
          {targets.length === 0 ? (
            <div className="empty">ยังไม่ได้เชื่อมต่อ Google Sheets — ตั้งค่าด้านล่าง</div>
          ) : (
            <table className="tbl cards">
              <thead>
                <tr>
                  <th>ชื่อ</th>
                  <th>Spreadsheet</th>
                  <th>Service Account</th>
                  <th>ขอบเขต</th>
                  <th>ซิงก์ล่าสุด</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.id} style={{ opacity: t.is_enabled ? 1 : 0.5 }}>
                    <td data-label="ชื่อ" className="card-title">{t.name}</td>
                    <td data-label="Spreadsheet">
                      <a href={`https://docs.google.com/spreadsheets/d/${t.spreadsheet_id}`}
                        target="_blank" rel="noreferrer">เปิดใน Google Sheets ↗</a>
                    </td>
                    <td data-label="Service Account" className="code" style={{ fontSize: 11 }}>
                      {t.service_account_email}
                    </td>
                    <td data-label="ขอบเขต">
                      {t.scope === 'YEAR' ? 'ทั้งปีบัญชี' : 'เฉพาะงวดล่าสุด'}
                    </td>
                    <td data-label="ซิงก์ล่าสุด">
                      {t.last_sync_at ? (
                        <>
                          <span className={`badge ${t.last_sync_ok ? 'ok' : 'danger'}`}>
                            {t.last_sync_ok ? 'สำเร็จ' : 'ไม่สำเร็จ'}
                          </span>
                          <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                            {new Date(t.last_sync_at).toLocaleString('th-TH')}
                            {t.last_sync_message ? ` · ${t.last_sync_message}` : ''}
                          </div>
                        </>
                      ) : (
                        <span className="muted">ยังไม่เคยซิงก์</span>
                      )}
                    </td>
                    <td data-label="จัดการ">
                      <div className="toolbar">
                        <button type="button" className="btn primary sm" disabled={pending}
                          onClick={() => run(() => syncNow(t.id))}>
                          {pending ? '…' : 'ซิงก์เดี๋ยวนี้'}
                        </button>
                        <button type="button" className={`btn sm${t.is_enabled ? '' : ' danger'}`} disabled={pending}
                          onClick={() => run(() => toggleTarget(t.id, !t.is_enabled))}>
                          {t.is_enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                        </button>
                        <button type="button" className="btn danger sm" disabled={pending}
                          onClick={() => { if (confirm('ลบการเชื่อมต่อนี้?')) run(() => deleteTarget(t.id)) }}>
                          ลบ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Collapsible label={targets.length === 0 ? '+ เชื่อมต่อ Google Sheets' : '+ เพิ่มการเชื่อมต่อใหม่'}
        defaultOpen={targets.length === 0}>
        <div className="card-body">
          <div className="alert warn">
            <div>
              <strong>ต้องตั้งค่าฝั่ง Google ก่อน ทำครั้งเดียว ประมาณ 10 นาที</strong>
              <ol style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13 }}>
                <li>เข้า <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer">Google Cloud Console</a> สร้างโปรเจกต์ใหม่ (ฟรี)</li>
                <li>ค้นหา <strong>Google Sheets API</strong> แล้วกด Enable</li>
                <li>ไปที่ IAM &amp; Admin → Service Accounts → Create service account</li>
                <li>เปิด Service Account ที่สร้าง → แท็บ Keys → Add key → Create new key → เลือก <strong>JSON</strong> → ได้ไฟล์มา</li>
                <li>สร้าง Google Sheet เปล่า แล้วกด <strong>แชร์</strong> ให้อีเมลของ Service Account เป็นสิทธิ์ <strong>ผู้แก้ไข</strong></li>
                <li>คัดลอกลิงก์ของ Sheet และเนื้อหาไฟล์ JSON มาวางด้านล่าง</li>
              </ol>
            </div>
          </div>

          <form
            action={(fd) => {
              setMsg(null)
              start(async () => {
                const res = await saveTarget(fd)
                setMsg({ ok: res.ok, text: res.ok ? (res.message ?? 'บันทึกแล้ว') : res.error })
                router.refresh()
              })
            }}
          >
            <div className="row">
              <div className="field">
                <label>ชื่อเรียก</label>
                <input type="text" name="name" defaultValue="สำนักงานบัญชี" />
              </div>
              <div className="field">
                <label>ขอบเขตข้อมูลที่ส่ง</label>
                <select name="scope" defaultValue="YEAR">
                  <option value="YEAR">ทั้งปีบัญชีปัจจุบัน</option>
                  <option value="PERIOD">เฉพาะงวดล่าสุดที่มีรายการ</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label>ลิงก์ Google Sheet หรือ Spreadsheet ID *</label>
              <input type="text" name="spreadsheet_id" required
                placeholder="https://docs.google.com/spreadsheets/d/xxxxx/edit" />
              <div className="hint">วางลิงก์ทั้งอันได้เลย ระบบตัดเอาเฉพาะรหัสให้เอง</div>
            </div>

            <div className="field">
              <label>เนื้อหาไฟล์ JSON ของ Service Account *</label>
              <textarea name="service_account_json" rows={6}
                placeholder={'{\n  "type": "service_account",\n  "client_email": "...",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n..."\n}'} />
              <div className="hint">
                เปิดไฟล์ JSON ที่ดาวน์โหลดมาด้วย Notepad แล้วคัดลอกทั้งไฟล์มาวาง ·
                ถ้าแก้ไขการเชื่อมต่อเดิมแล้วเว้นว่างไว้ ระบบจะใช้คีย์เดิม
              </div>
            </div>

            <div className="alert err">
              <div>
                คีย์นี้ถูกเก็บในฐานข้อมูล ใครที่อ่านฐานข้อมูลได้จะเขียน Google Sheet นั้นได้ด้วย —
                ใช้ Service Account ที่แชร์เฉพาะไฟล์นี้เท่านั้น อย่าให้สิทธิ์ระดับโปรเจกต์
              </div>
            </div>

            <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className="btn primary" disabled={pending}>
                {pending ? 'กำลังทดสอบและบันทึก…' : 'ทดสอบการเชื่อมต่อและบันทึก'}
              </button>
            </div>
          </form>
        </div>
      </Collapsible>

      {/* ───────── ตั้งเวลาซิงก์อัตโนมัติ ───────── */}
      {targets.length > 0 && cronToken && (
        <Collapsible label="ตั้งเวลาซิงก์อัตโนมัติ">
          <div className="card-body">
            <p style={{ fontSize: 13, marginTop: 0 }}>
              ให้ระบบตั้งเวลาของเครื่องเรียกที่อยู่นี้ เช่น Task Scheduler บน Windows
              หรือ cron บนเซิร์ฟเวอร์ · แนะนำวันละครั้งตอนกลางคืน
            </p>
            <pre className="code-block">
{`curl -X POST "http://localhost:3100/api/export/sync" \\
  -H "X-Export-Token: ${showToken ? cronToken : '••••••••••••••••••••••••'}"`}
            </pre>
            <div className="toolbar">
              <button type="button" className="btn sm" onClick={() => setShowToken((v) => !v)}>
                {showToken ? 'ซ่อนโทเคน' : 'แสดงโทเคน'}
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              โทเคนนี้ใช้เรียกซิงก์ได้โดยไม่ต้องล็อกอิน เก็บเป็นความลับ ·
              เปลี่ยนได้โดยแก้ค่า EXPORT_CRON_TOKEN ในตาราง system_settings
            </p>
          </div>
        </Collapsible>
      )}

      {/* ───────── ประวัติการซิงก์ ───────── */}
      {log.length > 0 && (
        <div className="card">
          <div className="card-head">ประวัติการซิงก์ล่าสุด</div>
          <div className="table-wrap">
            <table className="tbl cards">
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>ผล</th>
                  <th className="num">แถวที่ส่ง</th>
                  <th>ช่วงข้อมูล</th>
                  <th>สั่งโดย</th>
                  <th>รายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {log.map((l, i) => (
                  <tr key={i}>
                    <td data-label="เวลา" className="nowrap">
                      {new Date(l.started_at).toLocaleString('th-TH')}
                    </td>
                    <td data-label="ผล">
                      <span className={`badge ${l.succeeded ? 'ok' : l.succeeded === false ? 'danger' : 'warn'}`}>
                        {l.succeeded ? 'สำเร็จ' : l.succeeded === false ? 'ไม่สำเร็จ' : 'ค้างอยู่'}
                      </span>
                    </td>
                    <td data-label="แถวที่ส่ง" className="num">{l.rows_written ?? '—'}</td>
                    <td data-label="ช่วงข้อมูล">{l.range_label ?? '—'}</td>
                    <td data-label="สั่งโดย" className="muted">{l.triggered_by ?? '—'}</td>
                    <td data-label="รายละเอียด" className="muted" style={{ fontSize: 12 }}>
                      {l.message ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
