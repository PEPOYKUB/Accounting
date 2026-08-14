import { q, one } from './db'

export type Period = {
  id: string
  period_name: string
  start_date: string
  end_date: string
  status: 'OPEN' | 'CLOSED' | 'LOCKED'
}

export type Account = {
  id: string
  account_code: string
  account_name: string
  account_type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
  allow_posting: boolean
  is_active: boolean
  npae_report_line: string | null
}

export type Partner = {
  id: string
  partner_code: string
  partner_name: string
  tax_id: string | null
  default_wht_rate: string | null
  default_wht_form: string | null
  credit_days: number
}

export async function listPeriods(): Promise<Period[]> {
  return q<Period>(
    `SELECT id::text, period_name, start_date::text, end_date::text, status
       FROM acc.accounting_periods ORDER BY start_date`
  )
}

/**
 * งวดที่กำลังทำงานอยู่ = งวดของรายการบัญชีล่าสุดที่ลงบัญชีแล้ว
 * ถ้ายังไม่มีรายการเลย ใช้งวดที่ครอบคลุมวันนี้
 */
export async function workingPeriod(): Promise<Period | null> {
  const byEntry = await one<Period>(
    `SELECT p.id::text, p.period_name, p.start_date::text, p.end_date::text, p.status
       FROM acc.accounting_periods p
      WHERE p.id = (SELECT period_id FROM acc.journal_entries
                     WHERE status = 'POSTED' ORDER BY entry_date DESC, id DESC LIMIT 1)`
  )
  if (byEntry) return byEntry

  return one<Period>(
    `SELECT id::text, period_name, start_date::text, end_date::text, status
       FROM acc.accounting_periods WHERE CURRENT_DATE BETWEEN start_date AND end_date`
  )
}

export async function postableAccounts(): Promise<Account[]> {
  return q<Account>(
    `SELECT id::text, account_code, account_name, account_type, allow_posting, is_active, npae_report_line
       FROM acc.chart_of_accounts
      WHERE is_active AND allow_posting
      ORDER BY account_code`
  )
}

export async function accountsOfType(types: string[]): Promise<Account[]> {
  return q<Account>(
    `SELECT id::text, account_code, account_name, account_type, allow_posting, is_active, npae_report_line
       FROM acc.chart_of_accounts
      WHERE is_active AND allow_posting AND account_type = ANY($1::acc.account_type[])
      ORDER BY account_code`,
    [types]
  )
}

export async function customers(): Promise<Partner[]> {
  return q<Partner>(
    `SELECT id::text, partner_code, partner_name, tax_id, default_wht_rate::text,
            default_wht_form::text, credit_days
       FROM acc.business_partners WHERE is_customer AND is_active ORDER BY partner_code`
  )
}

export async function vendors(): Promise<Partner[]> {
  return q<Partner>(
    `SELECT id::text, partner_code, partner_name, tax_id, default_wht_rate::text,
            default_wht_form::text, credit_days
       FROM acc.business_partners WHERE is_vendor AND is_active ORDER BY partner_code`
  )
}

export async function bankAccounts() {
  return q<{ id: string; label: string }>(
    `SELECT b.id::text, b.bank_name || ' ' || b.account_no AS label
       FROM acc.bank_accounts b WHERE b.is_active ORDER BY b.id`
  )
}

export async function costCenters() {
  return q<{ id: string; code: string; name: string }>(
    `SELECT id::text, code, name FROM acc.cost_centers WHERE is_active ORDER BY code`
  )
}

/** ยอดคงเหลือของบัญชี ณ วันสิ้นงวดที่ระบุ (ด้านเดบิตเป็นบวก) */
export async function balancesAsOf(endDate: string) {
  return q<{
    account_code: string
    account_name: string
    account_type: string
    npae_report_line: string | null
    balance: string
  }>(
    `SELECT a.account_code, a.account_name, a.account_type::text, a.npae_report_line,
            COALESCE(SUM(l.debit_amount - l.credit_amount), 0)::text AS balance
       FROM acc.chart_of_accounts a
       JOIN acc.journal_entry_lines l ON l.account_id = a.id
       JOIN acc.journal_entries je ON je.id = l.journal_entry_id
      WHERE je.status = 'POSTED' AND je.entry_date <= $1::date
      GROUP BY a.account_code, a.account_name, a.account_type, a.npae_report_line
     HAVING COALESCE(SUM(l.debit_amount - l.credit_amount), 0) <> 0
      ORDER BY a.account_code`,
    [endDate]
  )
}

export async function healthCheck() {
  const eq = await one<{
    total_assets: string; total_liabilities: string; total_equity: string
    total_revenue: string; total_expense: string; out_of_balance: string
  }>(`SELECT * FROM acc.v_accounting_equation_check`)

  const control = await q<{
    control_account: string; gl_balance: string; sub_balance: string; difference: string
  }>(`SELECT * FROM acc.v_control_reconciliation`)

  return { eq, control }
}
