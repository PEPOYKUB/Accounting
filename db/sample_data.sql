-- =====================================================================
--  ข้อมูลตัวอย่าง — บริษัทที่ปรึกษา 2 เดือน (ก.ค. ปิดงวดแล้ว / ส.ค. ยังเปิดอยู่)
--  รันเอง ไม่ได้ติดตั้งอัตโนมัติ:
--    docker compose exec db psql -U postgres -d accounting -f /sql/sample_data.sql
--
--  สร้างสถานการณ์จริงครบ: ออกใบแจ้งหนี้ · รับชำระเต็ม/บางส่วน · ถูกลูกค้าหัก ณ ที่จ่าย
--  ตั้งหนี้-จ่ายผู้ขาย · เงินเดือน · ซื้อสินทรัพย์ · ค่าเสื่อม · ยื่น ภพ.30 · นำส่ง WHT · ปิดงวด
-- =====================================================================

BEGIN;
SET search_path TO acc, public;

-- ---------------------------------------------------------------------
-- ข้อมูลตั้งต้นของกิจการ
-- ---------------------------------------------------------------------
UPDATE acc.system_settings SET value = '0105566000111' WHERE key = 'COMPANY_TAX_ID';

-- ผู้ใช้งานมาจาก db/seed_demo_users.sql ซึ่งต้องรันก่อนไฟล์นี้
-- (id 1 = สมชาย ผู้บันทึก, id 2 = มาลี ผู้อนุมัติ)
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM acc.app_users) < 2 THEN
    RAISE EXCEPTION 'ต้องรัน db/seed_demo_users.sql ก่อนโหลดข้อมูลตัวอย่าง';
  END IF;
END $$;

INSERT INTO acc.fiscal_years (year_code, start_date, end_date)
VALUES ('FY2026','2026-01-01','2026-12-31');

INSERT INTO acc.accounting_periods (fiscal_year_id, period_no, period_name, start_date, end_date)
SELECT 1, n,
       to_char(make_date(2026, n, 1), 'YYYY-MM'),
       make_date(2026, n, 1),
       (make_date(2026, n, 1) + INTERVAL '1 month - 1 day')::DATE
  FROM generate_series(1,12) n;

INSERT INTO acc.cost_centers (code, name) VALUES
 ('CC01','ฝ่ายที่ปรึกษา'),
 ('CC02','ฝ่ายบริหาร');

INSERT INTO acc.business_partners
 (partner_code, partner_name, partner_kind, is_customer, is_vendor,
  tax_id, branch_code, address_line, default_wht_rate, default_wht_form, credit_days)
VALUES
 ('C001','บริษัท ลูกค้าใจดี จำกัด',      'JURISTIC',TRUE, FALSE,'0105551234567','00000','กรุงเทพมหานคร',3,'PND53',30),
 ('C002','บริษัท สยามเทคโนโลยี จำกัด',  'JURISTIC',TRUE, FALSE,'0105552345678','00000','กรุงเทพมหานคร',3,'PND53',30),
 ('C003','บริษัท กรีนเอนเนอร์จี จำกัด',  'JURISTIC',TRUE, FALSE,'0105553456789','00000','นนทบุรี',      3,'PND53',30),
 ('V001','บริษัท ผู้รับเหมาช่วง จำกัด',   'JURISTIC',FALSE,TRUE, '0105557654321','00000','กรุงเทพมหานคร',3,'PND53',30),
 ('V002','สำนักงานบัญชี ก้าวหน้า',        'JURISTIC',FALSE,TRUE, '0105558765432','00000','กรุงเทพมหานคร',3,'PND53',15);

INSERT INTO acc.bank_accounts (account_no, bank_name, branch_name, account_name, account_type, gl_account_id)
SELECT '123-4-56789-0','ธนาคารกสิกรไทย','สาขาสีลม','บริษัท เดโม คอนซัลติ้ง จำกัด','CURRENT', id
  FROM acc.chart_of_accounts WHERE account_code = '1020';

-- =====================================================================
--  กรกฎาคม 2569 — เดือนที่ปิดงวดเรียบร้อยแล้ว
-- =====================================================================

-- ยอดยกมาตั้งต้นระบบ
SELECT acc.post_journal_entry(
  'JV2026-00001', DATE '2026-07-01', 'OPENING', 'ยอดยกมาตั้งต้นระบบ ณ 1 ก.ค. 2569',
  '[{"code":"1020","dr":800000,"memo":"เงินฝากธนาคารยกมา"},
    {"code":"3000","cr":500000,"memo":"ทุนที่ออกและชำระแล้ว"},
    {"code":"3100","cr":300000,"memo":"กำไรสะสมยกมา"}]'::jsonb, 1, 2);

-- [R-1] ออกใบแจ้งหนี้ให้ลูกค้าใจดี 150,000 + VAT 7%
INSERT INTO acc.ar_invoices
 (doc_no, customer_id, issue_date, due_date, subtotal, vat_base, vat_amount,
  total_amount, expected_wht_rate, balance_due, status, created_by)
VALUES ('INV2026-00001', 1, '2026-07-05','2026-08-04', 150000, 150000, 10500,
        160500, 3, 160500, 'POSTED', 1);

INSERT INTO acc.ar_invoice_lines
 (invoice_id, line_no, description, quantity, unit_price, line_amount,
  revenue_account_id, vat_rate, vat_amount, cost_center_id)
SELECT 1, 1, 'ค่าที่ปรึกษาโครงการวางระบบ เดือนกรกฎาคม', 1, 150000, 150000,
       id, 7, 10500, 1
  FROM acc.chart_of_accounts WHERE account_code = '4010';

SELECT acc.post_journal_entry(
  'JV2026-00002', DATE '2026-07-05', 'SALES_INVOICE', 'ออกใบแจ้งหนี้ INV2026-00001',
  '[{"code":"1100","dr":160500,"partner_id":1,"ref":"INV2026-00001"},
    {"code":"4010","cr":150000,"cost_center_id":1},
    {"code":"2101","cr":10500,"memo":"พักภาษีขาย รอถึงจุดรับผิด"}]'::jsonb,
  1, 2, 'ar_invoices', 1);

-- [P-1] ตั้งหนี้ค่าทำบัญชีรายเดือน
INSERT INTO acc.ap_bills
 (doc_no, vendor_id, vendor_invoice_no, bill_date, due_date, subtotal, vat_amount,
  total_amount, vat_timing, wht_rate, wht_form, estimated_wht, balance_due, status, created_by)
VALUES ('BL2026-00001', 5, 'ACC-0707','2026-07-10','2026-07-25', 8000, 560,
        8560, 'ON_PAYMENT', 3, 'PND53', 240, 8560, 'POSTED', 1);

INSERT INTO acc.ap_bill_lines
 (bill_id, line_no, description, line_amount, expense_account_id, vat_rate, vat_amount, wht_rate, cost_center_id)
SELECT 1, 1, 'ค่าบริการทำบัญชี เดือนกรกฎาคม', 8000, id, 7, 560, 3, 2
  FROM acc.chart_of_accounts WHERE account_code = '5150';

SELECT acc.post_journal_entry(
  'JV2026-00003', DATE '2026-07-10', 'PURCHASE_BILL', 'ตั้งหนี้ BL2026-00001 ค่าทำบัญชี',
  '[{"code":"5150","dr":8000,"cost_center_id":2},
    {"code":"1151","dr":560,"memo":"พักภาษีซื้อ รอใบกำกับภาษี"},
    {"code":"2000","cr":8560,"partner_id":5,"ref":"BL2026-00001"}]'::jsonb,
  1, 2, 'ap_bills', 1);

-- [R-2] รับชำระเต็มจำนวน ลูกค้าหัก ณ ที่จ่าย 3% ของฐานก่อน VAT
INSERT INTO acc.ar_receipts
 (doc_no, customer_id, receipt_date, tax_invoice_no, tax_invoice_date,
  gross_amount, wht_amount, net_received, payment_method, bank_account_id, status, created_by)
VALUES ('RC2026-00001', 1, '2026-07-25','TI2026-00001','2026-07-25',
        160500, 4500, 156000, 'TRANSFER', 1, 'POSTED', 1);

INSERT INTO acc.ar_receipt_allocations (receipt_id, invoice_id, applied_amount, wht_amount)
VALUES (1, 1, 160500, 4500);

SELECT acc.post_journal_entry(
  'JV2026-00004', DATE '2026-07-25', 'SALES_RECEIPT', 'รับชำระ RC2026-00001 + ออกใบกำกับภาษี TI2026-00001',
  '[{"code":"1020","dr":156000,"memo":"เงินเข้าบัญชีจริง"},
    {"code":"1160","dr":4500,"partner_id":1,"memo":"ถูกหัก ณ ที่จ่าย 3%"},
    {"code":"1100","cr":160500,"partner_id":1,"ref":"INV2026-00001"},
    {"code":"2101","dr":10500,"memo":"โอนออกจากพักภาษีขาย"},
    {"code":"2100","cr":10500,"memo":"ภาษีขายถึงจุดรับผิดแล้ว"}]'::jsonb,
  1, 2, 'ar_receipts', 1);

UPDATE acc.ar_invoices SET paid_amount = 160500, balance_due = 0, status = 'PAID' WHERE id = 1;

INSERT INTO acc.vat_output_items
 (period_id, seq_no, tax_invoice_date, tax_invoice_no, customer_name,
  customer_tax_id, customer_branch, base_amount, vat_amount, source_type, source_doc_id)
VALUES (7, 1, '2026-07-25','TI2026-00001','บริษัท ลูกค้าใจดี จำกัด',
        '0105551234567','00000', 150000, 10500, 'SALES_RECEIPT', 1);

INSERT INTO acc.wht_received
 (customer_id, receipt_id, certificate_no, issue_date, fiscal_year_id,
  base_amount, wht_rate, wht_amount, is_document_received)
VALUES (1, 1, 'WHT-C001-0725','2026-07-25', 1, 150000, 3, 4500, TRUE);

-- [PR-1] เงินเดือนกรกฎาคม
INSERT INTO acc.payroll_batches
 (doc_no, period_id, pay_date, headcount, gross_salary, sso_employee, sso_employer,
  wht_pnd1, net_paid, source_system, status, created_by)
VALUES ('PR2026-0007', 7, '2026-07-28', 10, 250000, 7500, 7500, 6000, 236500,
        'ระบบเงินเดือนภายนอก', 'POSTED', 1);

SELECT acc.post_journal_entry(
  'JV2026-00005', DATE '2026-07-28', 'PAYROLL', 'เงินเดือนเดือนกรกฎาคม 2569 (10 คน)',
  '[{"code":"5110","dr":250000,"memo":"เงินเดือนรวมก่อนหัก"},
    {"code":"5112","dr":7500,"memo":"ประกันสังคมส่วนนายจ้าง"},
    {"code":"2200","cr":6000,"memo":"ภงด.1 ค้างนำส่ง"},
    {"code":"2210","cr":15000,"memo":"ประกันสังคมค้างนำส่ง ลูกจ้าง+นายจ้าง"},
    {"code":"1020","cr":236500,"memo":"โอนเงินเดือนพนักงาน"}]'::jsonb,
  1, 2, 'payroll_batches', 1);

-- [P-3] จ่ายชำระค่าทำบัญชี หัก ณ ที่จ่าย 3%
INSERT INTO acc.ap_payments
 (doc_no, vendor_id, payment_date, gross_amount, wht_amount, net_paid,
  payment_method, bank_account_id, status, created_by)
VALUES ('PV2026-00001', 5, '2026-07-31', 8560, 240, 8320, 'TRANSFER', 1, 'POSTED', 1);

INSERT INTO acc.ap_payment_allocations (payment_id, bill_id, applied_amount, wht_amount)
VALUES (1, 1, 8560, 240);

SELECT acc.post_journal_entry(
  'JV2026-00006', DATE '2026-07-31', 'PURCHASE_PAYMENT', 'จ่ายชำระ PV2026-00001 หัก ณ ที่จ่าย 3%',
  '[{"code":"2000","dr":8560,"partner_id":5,"ref":"BL2026-00001"},
    {"code":"2202","cr":240,"memo":"ภงด.53 ค้างนำส่ง"},
    {"code":"1020","cr":8320,"memo":"จ่ายเงินจริง"},
    {"code":"1150","dr":560,"memo":"ภาษีซื้อใช้สิทธิได้แล้ว"},
    {"code":"1151","cr":560,"memo":"ล้างพักภาษีซื้อ"}]'::jsonb,
  1, 2, 'ap_payments', 1);

UPDATE acc.ap_bills SET paid_amount = 8560, balance_due = 0, status = 'PAID' WHERE id = 1;

INSERT INTO acc.wht_certificates
 (doc_no, payment_id, payee_id, issue_date, period_id, wht_form, income_type,
  base_amount, wht_rate, wht_amount, is_remitted)
VALUES ('WT2026-00001', 1, 5, '2026-07-31', 7, 'PND53','40(2)', 8000, 3, 240, FALSE);

INSERT INTO acc.vat_input_items
 (period_id, seq_no, tax_invoice_date, tax_invoice_no, vendor_name,
  vendor_tax_id, vendor_branch, base_amount, vat_amount, source_type, source_doc_id)
VALUES (7, 1, '2026-07-31','ACC-TI-0707','สำนักงานบัญชี ก้าวหน้า',
        '0105558765432','00000', 8000, 560, 'PURCHASE_PAYMENT', 1);

-- [T-1] ปิดยอดภาษีมูลค่าเพิ่มเดือนกรกฎาคม
SELECT acc.post_journal_entry(
  'JV2026-00007', DATE '2026-07-31', 'TAX_REMITTANCE', 'ปิดยอด ภพ.30 เดือนกรกฎาคม 2569',
  '[{"code":"2100","dr":10500,"memo":"ล้างภาษีขาย"},
    {"code":"1150","cr":560,"memo":"ล้างภาษีซื้อ"},
    {"code":"2110","cr":9940,"memo":"ภาษีมูลค่าเพิ่มค้างชำระ"}]'::jsonb,
  1, 2);

INSERT INTO acc.vat_filings (period_id, output_vat, input_vat, net_payable)
VALUES (7, 10500, 560, 9940);

-- ปิดงวดกรกฎาคม (ระบบจะตรวจเช็กลิสต์ให้เองก่อนอนุญาต)
SELECT acc.close_period(7, 2);

-- =====================================================================
--  สิงหาคม 2569 — งวดที่ยังเปิดอยู่
-- =====================================================================

-- [FA-1] ซื้อโน้ตบุ๊กให้ทีมที่ปรึกษา (สินค้า -> ได้ใบกำกับภาษีทันที)
SELECT acc.post_journal_entry(
  'JV2026-00008', DATE '2026-08-01', 'PURCHASE_BILL', 'ซื้อโน้ตบุ๊ก 3 เครื่อง จ่ายสด',
  '[{"code":"1520","dr":36000,"memo":"คอมพิวเตอร์และอุปกรณ์"},
    {"code":"1150","dr":2520,"memo":"ภาษีซื้อ ได้ใบกำกับพร้อมของ"},
    {"code":"1020","cr":38520}]'::jsonb, 1, 2);

INSERT INTO acc.fixed_assets
 (asset_code, asset_name, category, purchase_date, in_service_date, cost, salvage_value,
  useful_life_years, depreciation_method, asset_account_id, accum_dep_account_id,
  dep_expense_account_id, cost_center_id)
SELECT 'FA-2026-001','โน้ตบุ๊กทีมที่ปรึกษา 3 เครื่อง','คอมพิวเตอร์',
       '2026-08-01','2026-08-01', 36000, 0, 3, 'STRAIGHT_LINE',
       (SELECT id FROM acc.chart_of_accounts WHERE account_code='1520'),
       (SELECT id FROM acc.chart_of_accounts WHERE account_code='1521'),
       (SELECT id FROM acc.chart_of_accounts WHERE account_code='5160'), 1;

INSERT INTO acc.vat_input_items
 (period_id, seq_no, tax_invoice_date, tax_invoice_no, vendor_name,
  vendor_tax_id, vendor_branch, base_amount, vat_amount, source_type, source_doc_id)
VALUES (8, 1, '2026-08-01','IT-TI-5521','ร้านไอทีซัพพลาย','0105559999888','00000',
        36000, 2520, 'PURCHASE_BILL', NULL);

-- [R-1] ใบแจ้งหนี้ที่ยังไม่ได้รับชำระ (จะโผล่ในรายงานอายุลูกหนี้)
INSERT INTO acc.ar_invoices
 (doc_no, customer_id, issue_date, due_date, subtotal, vat_base, vat_amount,
  total_amount, expected_wht_rate, balance_due, status, created_by)
VALUES ('INV2026-00002', 2, '2026-08-03','2026-09-02', 200000, 200000, 14000,
        214000, 3, 214000, 'POSTED', 1);

INSERT INTO acc.ar_invoice_lines
 (invoice_id, line_no, description, quantity, unit_price, line_amount,
  revenue_account_id, vat_rate, vat_amount, cost_center_id)
SELECT 2, 1, 'ค่าที่ปรึกษาวางระบบ ERP งวดที่ 1', 1, 200000, 200000, id, 7, 14000, 1
  FROM acc.chart_of_accounts WHERE account_code = '4010';

SELECT acc.post_journal_entry(
  'JV2026-00009', DATE '2026-08-03', 'SALES_INVOICE', 'ออกใบแจ้งหนี้ INV2026-00002',
  '[{"code":"1100","dr":214000,"partner_id":2,"ref":"INV2026-00002"},
    {"code":"4010","cr":200000,"cost_center_id":1},
    {"code":"2101","cr":14000}]'::jsonb,
  1, 2, 'ar_invoices', 2);

-- [T-2] นำส่งภาษีหัก ณ ที่จ่ายและประกันสังคมของเดือนกรกฎาคม
SELECT acc.post_journal_entry(
  'JV2026-00010', DATE '2026-08-07', 'TAX_REMITTANCE', 'นำส่ง ภงด.1, ภงด.53 และประกันสังคม เดือน ก.ค.',
  '[{"code":"2200","dr":6000,"memo":"ภงด.1"},
    {"code":"2202","dr":240,"memo":"ภงด.53"},
    {"code":"2210","dr":15000,"memo":"ประกันสังคม"},
    {"code":"1020","cr":21240}]'::jsonb, 1, 2);

UPDATE acc.wht_certificates SET is_remitted = TRUE WHERE doc_no = 'WT2026-00001';

-- [P-1] ตั้งหนี้ค่าจ้างผู้รับเหมาช่วง
INSERT INTO acc.ap_bills
 (doc_no, vendor_id, vendor_invoice_no, bill_date, due_date, subtotal, vat_amount,
  total_amount, vat_timing, wht_rate, wht_form, estimated_wht, balance_due, status, created_by)
VALUES ('BL2026-00002', 4, 'SUB-1188','2026-08-08','2026-09-07', 60000, 4200,
        64200, 'ON_PAYMENT', 3, 'PND53', 1800, 64200, 'POSTED', 1);

INSERT INTO acc.ap_bill_lines
 (bill_id, line_no, description, line_amount, expense_account_id, vat_rate, vat_amount, wht_rate, cost_center_id)
SELECT 2, 1, 'ค่าจ้างผู้รับเหมาช่วงงานติดตั้งระบบ', 60000, id, 7, 4200, 3, 1
  FROM acc.chart_of_accounts WHERE account_code = '5020';

SELECT acc.post_journal_entry(
  'JV2026-00011', DATE '2026-08-08', 'PURCHASE_BILL', 'ตั้งหนี้ BL2026-00002 ค่าจ้างผู้รับเหมาช่วง',
  '[{"code":"5020","dr":60000,"cost_center_id":1},
    {"code":"1151","dr":4200},
    {"code":"2000","cr":64200,"partner_id":4,"ref":"BL2026-00002"}]'::jsonb,
  1, 2, 'ap_bills', 2);

-- ชำระภาษีมูลค่าเพิ่มของเดือนกรกฎาคม
SELECT acc.post_journal_entry(
  'JV2026-00012', DATE '2026-08-15', 'TAX_REMITTANCE', 'ชำระ ภพ.30 เดือนกรกฎาคม 2569',
  '[{"code":"2110","dr":9940},
    {"code":"1020","cr":9940}]'::jsonb, 1, 2);

UPDATE acc.vat_filings SET filed_date = '2026-08-15', filed_by = 2 WHERE period_id = 7;

-- [R-1] ใบแจ้งหนี้อีกใบ จะรับชำระเพียงบางส่วน
INSERT INTO acc.ar_invoices
 (doc_no, customer_id, issue_date, due_date, subtotal, vat_base, vat_amount,
  total_amount, expected_wht_rate, balance_due, status, created_by)
VALUES ('INV2026-00003', 3, '2026-08-15','2026-09-14', 80000, 80000, 5600,
        85600, 3, 85600, 'POSTED', 1);

INSERT INTO acc.ar_invoice_lines
 (invoice_id, line_no, description, quantity, unit_price, line_amount,
  revenue_account_id, vat_rate, vat_amount, cost_center_id)
SELECT 3, 1, 'ค่าบริการดูแลระบบรายเดือน ส.ค.-ก.ย.', 2, 40000, 80000, id, 7, 5600, 1
  FROM acc.chart_of_accounts WHERE account_code = '4020';

SELECT acc.post_journal_entry(
  'JV2026-00013', DATE '2026-08-15', 'SALES_INVOICE', 'ออกใบแจ้งหนี้ INV2026-00003',
  '[{"code":"1100","dr":85600,"partner_id":3,"ref":"INV2026-00003"},
    {"code":"4020","cr":80000,"cost_center_id":1},
    {"code":"2101","cr":5600}]'::jsonb,
  1, 2, 'ar_invoices', 3);

-- [R-2] รับชำระ "บางส่วน" ครึ่งหนึ่ง -> พักภาษีขายต้องโอนตามสัดส่วนเท่านั้น
INSERT INTO acc.ar_receipts
 (doc_no, customer_id, receipt_date, tax_invoice_no, tax_invoice_date,
  gross_amount, wht_amount, net_received, payment_method, bank_account_id, status, created_by)
VALUES ('RC2026-00002', 3, '2026-08-22','TI2026-00002','2026-08-22',
        42800, 1200, 41600, 'TRANSFER', 1, 'POSTED', 1);

INSERT INTO acc.ar_receipt_allocations (receipt_id, invoice_id, applied_amount, wht_amount)
VALUES (2, 3, 42800, 1200);

SELECT acc.post_journal_entry(
  'JV2026-00014', DATE '2026-08-22', 'SALES_RECEIPT', 'รับชำระบางส่วน RC2026-00002 (ครึ่งหนึ่งของ INV2026-00003)',
  '[{"code":"1020","dr":41600},
    {"code":"1160","dr":1200,"partner_id":3,"memo":"ถูกหัก ณ ที่จ่าย 3% ของ 40,000"},
    {"code":"1100","cr":42800,"partner_id":3,"ref":"INV2026-00003"},
    {"code":"2101","dr":2800,"memo":"โอนพักภาษีขายตามสัดส่วนที่รับจริง"},
    {"code":"2100","cr":2800}]'::jsonb,
  1, 2, 'ar_receipts', 2);

UPDATE acc.ar_invoices SET paid_amount = 42800, balance_due = 42800, status = 'PARTIAL_PAID' WHERE id = 3;

INSERT INTO acc.vat_output_items
 (period_id, seq_no, tax_invoice_date, tax_invoice_no, customer_name,
  customer_tax_id, customer_branch, base_amount, vat_amount, source_type, source_doc_id)
VALUES (8, 1, '2026-08-22','TI2026-00002','บริษัท กรีนเอนเนอร์จี จำกัด',
        '0105553456789','00000', 40000, 2800, 'SALES_RECEIPT', 2);

INSERT INTO acc.wht_received
 (customer_id, receipt_id, certificate_no, issue_date, fiscal_year_id,
  base_amount, wht_rate, wht_amount, is_document_received)
VALUES (3, 2, NULL,'2026-08-22', 1, 40000, 3, 1200, FALSE);  -- ยังไม่ได้รับเอกสารตัวจริง

-- [P-3] จ่ายผู้รับเหมาช่วง
INSERT INTO acc.ap_payments
 (doc_no, vendor_id, payment_date, gross_amount, wht_amount, net_paid,
  payment_method, bank_account_id, status, created_by)
VALUES ('PV2026-00002', 4, '2026-08-28', 64200, 1800, 62400, 'TRANSFER', 1, 'POSTED', 1);

INSERT INTO acc.ap_payment_allocations (payment_id, bill_id, applied_amount, wht_amount)
VALUES (2, 2, 64200, 1800);

SELECT acc.post_journal_entry(
  'JV2026-00015', DATE '2026-08-28', 'PURCHASE_PAYMENT', 'จ่ายชำระ PV2026-00002 หัก ณ ที่จ่าย 3%',
  '[{"code":"2000","dr":64200,"partner_id":4,"ref":"BL2026-00002"},
    {"code":"2202","cr":1800},
    {"code":"1020","cr":62400},
    {"code":"1150","dr":4200},
    {"code":"1151","cr":4200}]'::jsonb,
  1, 2, 'ap_payments', 2);

UPDATE acc.ap_bills SET paid_amount = 64200, balance_due = 0, status = 'PAID' WHERE id = 2;

INSERT INTO acc.wht_certificates
 (doc_no, payment_id, payee_id, issue_date, period_id, wht_form, income_type,
  base_amount, wht_rate, wht_amount)
VALUES ('WT2026-00002', 2, 4, '2026-08-28', 8, 'PND53','40(8)', 60000, 3, 1800);

INSERT INTO acc.vat_input_items
 (period_id, seq_no, tax_invoice_date, tax_invoice_no, vendor_name,
  vendor_tax_id, vendor_branch, base_amount, vat_amount, source_type, source_doc_id)
VALUES (8, 2, '2026-08-28','SUB-TI-1188','บริษัท ผู้รับเหมาช่วง จำกัด',
        '0105557654321','00000', 60000, 4200, 'PURCHASE_PAYMENT', 2);

-- [PR-1] เงินเดือนสิงหาคม
INSERT INTO acc.payroll_batches
 (doc_no, period_id, pay_date, headcount, gross_salary, sso_employee, sso_employer,
  wht_pnd1, net_paid, source_system, status, created_by)
VALUES ('PR2026-0008', 8, '2026-08-28', 10, 250000, 7500, 7500, 6000, 236500,
        'ระบบเงินเดือนภายนอก', 'POSTED', 1);

SELECT acc.post_journal_entry(
  'JV2026-00016', DATE '2026-08-28', 'PAYROLL', 'เงินเดือนเดือนสิงหาคม 2569 (10 คน)',
  '[{"code":"5110","dr":250000},
    {"code":"5112","dr":7500},
    {"code":"2200","cr":6000},
    {"code":"2210","cr":15000},
    {"code":"1020","cr":236500}]'::jsonb,
  1, 2, 'payroll_batches', 2);

-- [FA-2] ค่าเสื่อมราคาสิงหาคม 36,000 / 3 ปี / 12 เดือน = 1,000
SELECT acc.post_journal_entry(
  'JV2026-00017', DATE '2026-08-31', 'DEPRECIATION', 'ค่าเสื่อมราคาประจำเดือนสิงหาคม 2569',
  '[{"code":"5160","dr":1000,"cost_center_id":1},
    {"code":"1521","cr":1000}]'::jsonb, 1, 2);

INSERT INTO acc.depreciation_entries (fixed_asset_id, period_id, depreciation_amount, journal_entry_id)
SELECT 1, 8, 1000, id FROM acc.journal_entries WHERE entry_no = 'JV2026-00017';

UPDATE acc.fixed_assets SET accumulated_depreciation = 1000 WHERE id = 1;

-- ผูกเลขใบสำคัญกลับเข้าเอกสารต้นทาง เพื่อให้เปิดดูรายการบัญชีจากหน้าเอกสารได้
UPDATE acc.ar_invoices d SET journal_entry_id = je.id
  FROM acc.journal_entries je
 WHERE je.source_table = 'ar_invoices' AND je.source_doc_id = d.id AND d.journal_entry_id IS NULL;
UPDATE acc.ar_receipts d SET journal_entry_id = je.id
  FROM acc.journal_entries je
 WHERE je.source_table = 'ar_receipts' AND je.source_doc_id = d.id AND d.journal_entry_id IS NULL;
UPDATE acc.ap_bills d SET journal_entry_id = je.id
  FROM acc.journal_entries je
 WHERE je.source_table = 'ap_bills' AND je.source_doc_id = d.id AND d.journal_entry_id IS NULL;
UPDATE acc.ap_payments d SET journal_entry_id = je.id
  FROM acc.journal_entries je
 WHERE je.source_table = 'ap_payments' AND je.source_doc_id = d.id AND d.journal_entry_id IS NULL;
UPDATE acc.payroll_batches d SET journal_entry_id = je.id
  FROM acc.journal_entries je
 WHERE je.source_table = 'payroll_batches' AND je.source_doc_id = d.id AND d.journal_entry_id IS NULL;

-- ปรับลำดับเลขที่เอกสารให้ตรงกับที่ใช้ไปแล้ว
INSERT INTO acc.document_sequences (doc_type, year_key, prefix, pad_length, last_number, reset_cycle) VALUES
 ('INV','2026','INV',5,3,'YEARLY'),
 ('RC', '2026','RC', 5,2,'YEARLY'),
 ('TXI','2026','TI', 5,2,'YEARLY'),
 ('BL', '2026','BL', 5,2,'YEARLY'),
 ('PV', '2026','PV', 5,2,'YEARLY'),
 ('WHT','2026','WT', 5,2,'YEARLY'),
 ('JV', '2026','JV', 5,17,'YEARLY');

COMMIT;

-- =====================================================================
--  ตรวจความถูกต้องหลังโหลดข้อมูล
-- =====================================================================
\echo ''
\echo '=== สมการบัญชี (out_of_balance ต้องเป็น 0.00) ==='
SELECT total_assets, total_liabilities, total_equity, total_revenue, total_expense, out_of_balance
  FROM acc.v_accounting_equation_check;

\echo ''
\echo '=== กระทบยอดบัญชีคุมกับบัญชีย่อย (difference ต้องเป็น 0.00) ==='
SELECT * FROM acc.v_control_reconciliation;

\echo ''
\echo '=== อายุลูกหนี้คงค้าง ==='
SELECT partner_name, doc_no, due_date, balance_due, aging_bucket FROM acc.v_ar_aging ORDER BY due_date;
