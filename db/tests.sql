-- =====================================================================
--  ชุดทดสอบ Invariant ของระบบบัญชี
--  รันหลัง schema.sql และ seed_chart_of_accounts.sql
--    docker exec -e PGCLIENTENCODING=UTF8 <container> \
--      psql -U postgres -d accounting -v ON_ERROR_STOP=1 -f tests.sql
--  ผ่านทั้งหมด = exit code 0 / มีข้อใดพลาด = exit code ไม่เป็นศูนย์
-- =====================================================================

SET search_path TO acc, public;
CREATE SCHEMA IF NOT EXISTS tst;

CREATE TABLE IF NOT EXISTS tst.results (
    seq     SERIAL PRIMARY KEY,
    label   TEXT,
    status  TEXT,
    detail  TEXT
);
TRUNCATE tst.results RESTART IDENTITY;

-- ---------------------------------------------------------------------
-- เครื่องมือช่วยทดสอบ
-- ---------------------------------------------------------------------

-- สร้าง Journal Entry ตามลำดับที่ระบบบังคับ: DRAFT -> ใส่บรรทัด -> POSTED
CREATE OR REPLACE FUNCTION tst.mk_je(
    p_no       TEXT,
    p_date     DATE,
    p_src      acc.je_source,
    p_desc     TEXT,
    p_lines    JSONB,
    p_post     BOOLEAN DEFAULT TRUE,
    p_approver BIGINT  DEFAULT 2
) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
    v_id   BIGINT;
    v_line JSONB;
    v_i    INT := 0;
    v_acc  BIGINT;
BEGIN
    INSERT INTO acc.journal_entries
        (entry_no, entry_date, period_id, source_type, description, status, created_by)
    VALUES (p_no, p_date, 1, p_src, p_desc, 'DRAFT', 1)
    RETURNING id INTO v_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_i := v_i + 1;
        SELECT id INTO v_acc FROM acc.chart_of_accounts WHERE account_code = v_line->>'code';
        IF v_acc IS NULL THEN
            RAISE EXCEPTION 'ไม่พบบัญชีรหัส %', v_line->>'code';
        END IF;
        INSERT INTO acc.journal_entry_lines
            (journal_entry_id, line_no, account_id, debit_amount, credit_amount, description, partner_id)
        VALUES (v_id, v_i, v_acc,
                COALESCE((v_line->>'dr')::NUMERIC, 0),
                COALESCE((v_line->>'cr')::NUMERIC, 0),
                v_line->>'d',
                (v_line->>'p')::BIGINT);
    END LOOP;

    IF p_post THEN
        UPDATE acc.journal_entries
           SET status = 'POSTED', approved_by = p_approver
         WHERE id = v_id;
        -- บังคับให้ constraint แบบ deferred ตรวจทันที เพื่อให้เทสต์จับผลได้ในจุดนี้
        SET CONSTRAINTS ALL IMMEDIATE;
    END IF;

    RETURN v_id;
END $$;

-- คาดว่าคำสั่งนี้ต้องล้มเหลว
CREATE OR REPLACE FUNCTION tst.expect_error(p_label TEXT, p_sql TEXT)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
        INSERT INTO tst.results(label, status, detail)
        VALUES (p_label, 'FAIL', 'คาดว่าต้องถูกปฏิเสธ แต่ระบบยอมรับ');
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO tst.results(label, status, detail)
        VALUES (p_label, 'PASS', left(replace(SQLERRM, E'\n', ' '), 90));
    END;
END $$;

-- เปรียบเทียบค่าที่ได้กับค่าที่คาด
CREATE OR REPLACE FUNCTION tst.expect_eq(p_label TEXT, p_actual NUMERIC, p_expected NUMERIC)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO tst.results(label, status, detail)
    VALUES (p_label,
            CASE WHEN COALESCE(p_actual, -999999) = p_expected THEN 'PASS' ELSE 'FAIL' END,
            format('ได้ %s / คาด %s', COALESCE(p_actual::TEXT,'NULL'), p_expected));
END $$;

-- ยอดคงเหลือของบัญชี (ด้านเดบิตเป็นบวก)
CREATE OR REPLACE FUNCTION tst.bal(p_code TEXT)
RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(m.debit_amount - m.credit_amount), 0)
      FROM acc.v_gl_movements m
     WHERE m.account_code = p_code;
$$;

-- =====================================================================
-- SETUP: ปีบัญชี งวด ผู้ใช้ คู่ค้า ธนาคาร
-- =====================================================================

INSERT INTO acc.app_users (username, full_name, password_hash) VALUES
 ('somchai','สมชาย (นักบัญชี AR/AP)','x'),
 ('malee','มาลี (ผู้จัดการบัญชี)','x'),
 ('solo','คนเดียวทำทุกอย่าง','x');

INSERT INTO acc.fiscal_years (year_code, start_date, end_date)
VALUES ('FY2026','2026-01-01','2026-12-31');

INSERT INTO acc.accounting_periods (fiscal_year_id, period_no, period_name, start_date, end_date)
SELECT 1, n,
       to_char(make_date(2026, n, 1), 'YYYY-MM'),
       make_date(2026, n, 1),
       (make_date(2026, n, 1) + INTERVAL '1 month - 1 day')::DATE
  FROM generate_series(1,12) n;

INSERT INTO acc.business_partners
 (partner_code, partner_name, partner_kind, is_customer, is_vendor, tax_id, branch_code, default_wht_rate, default_wht_form)
VALUES
 ('C001','บริษัท ลูกค้าใจดี จำกัด','JURISTIC',TRUE,FALSE,'0105551234567','00000',3,'PND53'),
 ('V001','บริษัท ผู้รับเหมาช่วง จำกัด','JURISTIC',FALSE,TRUE,'0105557654321','00000',3,'PND53');

INSERT INTO acc.bank_accounts (account_no, bank_name, account_name, gl_account_id)
SELECT '123-4-56789-0','ธนาคารกสิกรไทย','บริษัท ทดสอบ จำกัด', id
  FROM acc.chart_of_accounts WHERE account_code = '1020';

-- =====================================================================
-- T01 · ยอดยกมาตั้งต้น (JE ที่สมดุลต้องบันทึกได้)
-- =====================================================================
SELECT tst.mk_je('JV-OPENING','2026-08-01','OPENING','ยอดยกมาตั้งต้นระบบ', $$[
  {"code":"1020","dr":500000,"d":"เงินฝากธนาคารยกมา"},
  {"code":"3000","cr":500000,"d":"ทุนที่ชำระแล้ว"}
]$$::jsonb);

SELECT tst.expect_eq('T01 ยอดยกมาบันทึกได้ เงินฝาก = 500,000', tst.bal('1020'), 500000);

-- =====================================================================
-- T02-T04 · กฎเหล็กเรื่องความสมดุลและลำดับการบันทึก
-- =====================================================================
SELECT tst.expect_error('T02 Dr <> Cr ต้องถูกปฏิเสธ', $$
  SELECT tst.mk_je('JV-BAD1','2026-08-02','MANUAL','ไม่สมดุล', '[
    {"code":"1010","dr":100},{"code":"4000","cr":90}]'::jsonb)
$$);

SELECT tst.expect_error('T03 JE บรรทัดเดียวต้องถูกปฏิเสธ', $$
  SELECT tst.mk_je('JV-BAD2','2026-08-02','MANUAL','บรรทัดเดียว', '[
    {"code":"1010","dr":100}]'::jsonb)
$$);

SELECT tst.expect_error('T04 ห้าม INSERT เป็น POSTED โดยตรง', $$
  INSERT INTO acc.journal_entries
    (entry_no, entry_date, period_id, source_type, description, status, created_by, approved_by, posted_at)
  VALUES ('JV-BAD3','2026-08-02',8,'MANUAL','ลัดขั้นตอน','POSTED',1,2,now())
$$);

-- =====================================================================
-- T05-T07 · ความคงทนของรายการที่ลงบัญชีแล้ว
-- =====================================================================
SELECT tst.expect_error('T05 ห้ามแก้ JE ที่ POSTED', $$
  UPDATE acc.journal_entries SET description = 'แก้ไขย้อนหลัง' WHERE entry_no = 'JV-OPENING'
$$);

SELECT tst.expect_error('T06 ห้ามลบ JE ที่ POSTED', $$
  DELETE FROM acc.journal_entries WHERE entry_no = 'JV-OPENING'
$$);

SELECT tst.expect_error('T07 ห้ามเพิ่มบรรทัดให้ JE ที่ POSTED', $$
  INSERT INTO acc.journal_entry_lines (journal_entry_id, line_no, account_id, debit_amount)
  SELECT je.id, 99, c.id, 1
    FROM acc.journal_entries je, acc.chart_of_accounts c
   WHERE je.entry_no = 'JV-OPENING' AND c.account_code = '1010'
$$);

-- =====================================================================
-- T08-T12 · กฎควบคุมอื่น ๆ
-- =====================================================================
UPDATE acc.accounting_periods SET status = 'CLOSED' WHERE period_name = '2026-01';

SELECT tst.expect_error('T08 ห้ามลงบัญชีในงวดที่ปิดแล้ว', $$
  SELECT tst.mk_je('JV-BAD4','2026-01-15','MANUAL','ย้อนเข้างวดที่ปิด', '[
    {"code":"1010","dr":100},{"code":"4000","cr":100}]'::jsonb)
$$);

SELECT tst.expect_error('T09 ห้ามลงบัญชีคุม (allow_posting = false)', $$
  SELECT tst.mk_je('JV-BAD5','2026-08-02','MANUAL','ลงบัญชีหัวข้อ', '[
    {"code":"1000","dr":100},{"code":"4000","cr":100}]'::jsonb)
$$);

SELECT tst.expect_error('T10 ผู้อนุมัติต้องไม่ใช่ผู้บันทึก', $$
  SELECT tst.mk_je('JV-BAD6','2026-08-02','MANUAL','อนุมัติตัวเอง', '[
    {"code":"1010","dr":100},{"code":"4000","cr":100}]'::jsonb, TRUE, 1)
$$);

SELECT tst.expect_error('T11 งวดบัญชีห้ามซ้อนทับกัน', $$
  INSERT INTO acc.accounting_periods (fiscal_year_id, period_no, period_name, start_date, end_date)
  VALUES (1, 13, '2026-08-ซ้อน', '2026-08-15', '2026-09-15')
$$);

SELECT tst.expect_error('T12 บรรทัดเดียวมีทั้ง Dr และ Cr ไม่ได้', $$
  SELECT tst.mk_je('JV-BAD7','2026-08-02','MANUAL','สองด้านในบรรทัดเดียว', '[
    {"code":"1010","dr":100,"cr":100},{"code":"4000","cr":100}]'::jsonb)
$$);

-- =====================================================================
-- T13 · วงจรรายรับธุรกิจบริการเต็มรอบ (R-1 -> R-2)
--       ค่าบริการ 100,000 + VAT 7% ลูกค้าหัก ณ ที่จ่าย 3%
-- =====================================================================

-- [R-1] ออกใบแจ้งหนี้
INSERT INTO acc.ar_invoices
 (doc_no, customer_id, issue_date, due_date, subtotal, vat_base, vat_amount,
  total_amount, expected_wht_rate, balance_due, status, created_by)
VALUES ('INV2026-00001', 1, '2026-08-05','2026-09-04', 100000, 100000, 7000,
        107000, 3, 107000, 'POSTED', 1);

INSERT INTO acc.ar_invoice_lines
 (invoice_id, line_no, description, unit_price, line_amount, revenue_account_id, vat_rate, vat_amount)
SELECT 1, 1, 'ค่าบริการที่ปรึกษาเดือนสิงหาคม', 100000, 100000, id, 7, 7000
  FROM acc.chart_of_accounts WHERE account_code = '4000';

SELECT tst.mk_je('INV-JE-00001','2026-08-05','SALES_INVOICE','ออกใบแจ้งหนี้ INV2026-00001', $$[
  {"code":"1100","dr":107000,"p":1,"d":"ลูกหนี้การค้า"},
  {"code":"4000","cr":100000,"d":"รายได้จากการให้บริการ"},
  {"code":"2101","cr":7000,"d":"พักภาษีขาย (ยังไม่ถึงจุดรับผิด)"}
]$$::jsonb);

SELECT tst.expect_eq('T13a ออกใบแจ้งหนี้: ลูกหนี้ = 107,000', tst.bal('1100'), 107000);
SELECT tst.expect_eq('T13b ออกใบแจ้งหนี้: ภาษีขายจริงต้องยังเป็น 0', tst.bal('2100'), 0);
SELECT tst.expect_eq('T13c ออกใบแจ้งหนี้: พักภาษีขาย = 7,000', tst.bal('2101'), -7000);

-- [R-2] รับชำระเงิน ลูกค้าหัก ณ ที่จ่าย 3% ของฐานก่อน VAT
INSERT INTO acc.ar_receipts
 (doc_no, customer_id, receipt_date, tax_invoice_no, tax_invoice_date,
  gross_amount, wht_amount, net_received, bank_account_id, status, created_by)
VALUES ('RC2026-00001', 1, '2026-08-20','TI2026-00001','2026-08-20',
        107000, 3000, 104000, 1, 'POSTED', 1);

INSERT INTO acc.ar_receipt_allocations (receipt_id, invoice_id, applied_amount, wht_amount)
VALUES (1, 1, 107000, 3000);

SELECT tst.mk_je('RC-JE-00001','2026-08-20','SALES_RECEIPT','รับชำระ RC2026-00001 + ออกใบกำกับภาษี', $$[
  {"code":"1020","dr":104000,"d":"เงินเข้าบัญชีจริง"},
  {"code":"1160","dr":3000,"p":1,"d":"ภาษีถูกหัก ณ ที่จ่าย 3%"},
  {"code":"1100","cr":107000,"p":1,"d":"ตัดลูกหนี้การค้า"},
  {"code":"2101","dr":7000,"d":"โอนออกจากพักภาษีขาย"},
  {"code":"2100","cr":7000,"d":"ภาษีขายถึงจุดรับผิดแล้ว"}
]$$::jsonb);

UPDATE acc.ar_invoices SET paid_amount = 107000, balance_due = 0, status = 'PAID' WHERE id = 1;

INSERT INTO acc.vat_output_items
 (period_id, seq_no, tax_invoice_date, tax_invoice_no, customer_name,
  customer_tax_id, customer_branch, base_amount, vat_amount, source_type, source_doc_id)
VALUES (8, 1, '2026-08-20','TI2026-00001','บริษัท ลูกค้าใจดี จำกัด',
        '0105551234567','00000', 100000, 7000, 'SALES_RECEIPT', 1);

INSERT INTO acc.wht_received
 (customer_id, receipt_id, certificate_no, issue_date, fiscal_year_id, base_amount, wht_rate, wht_amount)
VALUES (1, 1, 'WHT-C-001','2026-08-20', 1, 100000, 3, 3000);

SELECT tst.expect_eq('T13d รับชำระแล้ว: ลูกหนี้ต้องเป็น 0',            tst.bal('1100'), 0);
SELECT tst.expect_eq('T13e รับชำระแล้ว: พักภาษีขายต้องเป็น 0',         tst.bal('2101'), 0);
SELECT tst.expect_eq('T13f รับชำระแล้ว: ภาษีขาย = 7,000',              tst.bal('2100'), -7000);
SELECT tst.expect_eq('T13g รับชำระแล้ว: ภาษีถูกหัก ณ ที่จ่าย = 3,000', tst.bal('1160'), 3000);
SELECT tst.expect_eq('T13h รายงานภาษีขายต้องตรงกับบัญชี 2100',
       (SELECT SUM(vat_amount) FROM acc.vat_output_items), -tst.bal('2100'));

-- =====================================================================
-- T14 · วงจรรายจ่ายพร้อมหักภาษี ณ ที่จ่าย (P-1 -> P-3)
--       ค่าจ้างผู้รับเหมาช่วง 50,000 + VAT 7% หัก 3%
-- =====================================================================

INSERT INTO acc.ap_bills
 (doc_no, vendor_id, vendor_invoice_no, bill_date, due_date, subtotal, vat_amount,
  total_amount, vat_timing, wht_rate, wht_form, estimated_wht, balance_due, status, created_by)
VALUES ('BL2026-00001', 2, 'V-INV-889','2026-08-10','2026-09-09', 50000, 3500,
        53500, 'ON_PAYMENT', 3, 'PND53', 1500, 53500, 'POSTED', 1);

INSERT INTO acc.ap_bill_lines
 (bill_id, line_no, description, line_amount, expense_account_id, vat_rate, vat_amount, wht_rate)
SELECT 1, 1, 'ค่าจ้างผู้รับเหมาช่วงงานติดตั้ง', 50000, id, 7, 3500, 3
  FROM acc.chart_of_accounts WHERE account_code = '5020';

SELECT tst.mk_je('BL-JE-00001','2026-08-10','PURCHASE_BILL','ตั้งหนี้ BL2026-00001', $$[
  {"code":"5020","dr":50000,"d":"ค่าจ้างผู้รับเหมาช่วง"},
  {"code":"1151","dr":3500,"d":"พักภาษีซื้อ (ยังไม่ได้ใบกำกับ)"},
  {"code":"2000","cr":53500,"p":2,"d":"เจ้าหนี้การค้า เต็มจำนวน"}
]$$::jsonb);

SELECT tst.expect_eq('T14a ตั้งหนี้: เจ้าหนี้ = 53,500 (เต็มจำนวน ไม่หัก WHT)', tst.bal('2000'), -53500);
SELECT tst.expect_eq('T14b ตั้งหนี้: ภาษีซื้อจริงต้องยังเป็น 0',              tst.bal('1150'), 0);

INSERT INTO acc.ap_payments
 (doc_no, vendor_id, payment_date, gross_amount, wht_amount, net_paid, bank_account_id, status, created_by)
VALUES ('PV2026-00001', 2, '2026-08-25', 53500, 1500, 52000, 1, 'POSTED', 1);

INSERT INTO acc.ap_payment_allocations (payment_id, bill_id, applied_amount, wht_amount)
VALUES (1, 1, 53500, 1500);

SELECT tst.mk_je('PV-JE-00001','2026-08-25','PURCHASE_PAYMENT','จ่ายชำระ PV2026-00001 หัก ณ ที่จ่าย 3%', $$[
  {"code":"2000","dr":53500,"p":2,"d":"ตัดเจ้าหนี้การค้า"},
  {"code":"2202","cr":1500,"d":"ภงด.53 ค้างนำส่ง"},
  {"code":"1020","cr":52000,"d":"จ่ายเงินจริง"},
  {"code":"1150","dr":3500,"d":"ภาษีซื้อใช้สิทธิได้แล้ว"},
  {"code":"1151","cr":3500,"d":"ล้างพักภาษีซื้อ"}
]$$::jsonb);

UPDATE acc.ap_bills SET paid_amount = 53500, balance_due = 0, status = 'PAID' WHERE id = 1;

INSERT INTO acc.wht_certificates
 (doc_no, payment_id, payee_id, issue_date, period_id, wht_form, income_type, base_amount, wht_rate, wht_amount)
VALUES ('WT2026-00001', 1, 2, '2026-08-25', 8, 'PND53','40(8)', 50000, 3, 1500);

INSERT INTO acc.vat_input_items
 (period_id, seq_no, tax_invoice_date, tax_invoice_no, vendor_name,
  vendor_tax_id, vendor_branch, base_amount, vat_amount, source_type, source_doc_id)
VALUES (8, 1, '2026-08-25','V-TI-889','บริษัท ผู้รับเหมาช่วง จำกัด',
        '0105557654321','00000', 50000, 3500, 'PURCHASE_PAYMENT', 1);

SELECT tst.expect_eq('T14c จ่ายแล้ว: เจ้าหนี้ต้องเป็น 0',        tst.bal('2000'), 0);
SELECT tst.expect_eq('T14d จ่ายแล้ว: พักภาษีซื้อต้องเป็น 0',     tst.bal('1151'), 0);
SELECT tst.expect_eq('T14e จ่ายแล้ว: ภาษีซื้อ = 3,500',          tst.bal('1150'), 3500);
SELECT tst.expect_eq('T14f จ่ายแล้ว: ภงด.53 ค้างนำส่ง = 1,500',  tst.bal('2202'), -1500);
SELECT tst.expect_eq('T14g WHT ต้องคิดจากฐานก่อน VAT (50,000 x 3%)',
       (SELECT wht_amount FROM acc.wht_certificates WHERE doc_no = 'WT2026-00001'), 1500);

-- =====================================================================
-- T15 · เงินเดือน (รับยอดสรุป)
-- =====================================================================
INSERT INTO acc.payroll_batches
 (doc_no, period_id, pay_date, headcount, gross_salary, sso_employee, sso_employer,
  wht_pnd1, net_paid, source_system, status, created_by)
VALUES ('PR2026-0008', 8, '2026-08-28', 10, 300000, 7500, 7500, 8000, 284500,
        'ระบบเงินเดือนภายนอก', 'POSTED', 1);

SELECT tst.mk_je('PR-JE-00008','2026-08-28','PAYROLL','เงินเดือนเดือนสิงหาคม 2569', $$[
  {"code":"5110","dr":300000,"d":"เงินเดือนและค่าแรง"},
  {"code":"5112","dr":7500,"d":"ประกันสังคมส่วนนายจ้าง"},
  {"code":"2200","cr":8000,"d":"ภงด.1 ค้างนำส่ง"},
  {"code":"2210","cr":15000,"d":"ประกันสังคมค้างนำส่ง ทั้งสองฝ่าย"},
  {"code":"1020","cr":284500,"d":"โอนเงินเดือนพนักงาน"}
]$$::jsonb);

SELECT tst.expect_eq('T15a เงินเดือน: ประกันสังคมค้างนำส่ง = 15,000 (สองฝ่ายรวมกัน)', tst.bal('2210'), -15000);
SELECT tst.expect_eq('T15b เงินเดือน: ค่าใช้จ่ายบริษัทฝั่งประกันสังคม = 7,500',        tst.bal('5112'), 7500);

-- =====================================================================
-- T16 · ค่าเสื่อมราคา ห้ามคิดซ้ำงวดเดียวกัน
-- =====================================================================
INSERT INTO acc.fixed_assets
 (asset_code, asset_name, purchase_date, in_service_date, cost, salvage_value,
  useful_life_years, asset_account_id, accum_dep_account_id, dep_expense_account_id)
SELECT 'FA-001','โน้ตบุ๊กสำหรับทีมที่ปรึกษา','2026-08-01','2026-08-01', 36000, 0, 3,
       (SELECT id FROM acc.chart_of_accounts WHERE account_code='1520'),
       (SELECT id FROM acc.chart_of_accounts WHERE account_code='1521'),
       (SELECT id FROM acc.chart_of_accounts WHERE account_code='5160');

SELECT tst.mk_je('DP-JE-00008','2026-08-31','DEPRECIATION','ค่าเสื่อมราคาเดือนสิงหาคม', $$[
  {"code":"5160","dr":1000,"d":"ค่าเสื่อมราคา 36,000 / 3 ปี / 12 เดือน"},
  {"code":"1521","cr":1000,"d":"ค่าเสื่อมราคาสะสม - คอมพิวเตอร์"}
]$$::jsonb);

INSERT INTO acc.depreciation_entries (fixed_asset_id, period_id, depreciation_amount)
VALUES (1, 8, 1000);
UPDATE acc.fixed_assets SET accumulated_depreciation = 1000 WHERE id = 1;

SELECT tst.expect_error('T16a ห้ามคิดค่าเสื่อมซ้ำงวดเดิม', $$
  INSERT INTO acc.depreciation_entries (fixed_asset_id, period_id, depreciation_amount)
  VALUES (1, 8, 1000)
$$);

SELECT tst.expect_eq('T16b ราคาตามบัญชีคำนวณอัตโนมัติ = 35,000',
       (SELECT book_value FROM acc.fixed_assets WHERE id = 1), 35000);

SELECT tst.expect_error('T16c ค่าเสื่อมสะสมห้ามเกินราคาทุน', $$
  UPDATE acc.fixed_assets SET accumulated_depreciation = 40000 WHERE id = 1
$$);

-- =====================================================================
-- T17 · เลขที่เอกสารต้องไม่ซ้ำและไม่ข้าม
-- =====================================================================
CREATE TEMP TABLE docnos AS
SELECT acc.next_doc_no('INV','2026-08-15') AS no FROM generate_series(1,100);

SELECT tst.expect_eq('T17a ออกเลขที่เอกสาร 100 ใบ ต้องไม่ซ้ำเลย',
       (SELECT COUNT(DISTINCT no) FROM docnos), 100);
SELECT tst.expect_eq('T17b เลขต้องเรียงต่อเนื่องไม่ข้าม (ใบสุดท้าย = 00100)',
       (SELECT COUNT(*) FROM docnos WHERE no = 'INV2026-00100'), 1);

-- =====================================================================
-- T18-T20 · ความถูกต้องรวมของระบบ
-- =====================================================================
SELECT tst.expect_eq('T18 สมการบัญชีต้องสมดุล (สินทรัพย์ = หนี้สิน + ทุน)',
       (SELECT out_of_balance FROM acc.v_accounting_equation_check), 0);

SELECT tst.expect_eq('T19a บัญชีคุมลูกหนี้ต้องตรงกับบัญชีย่อย',
       (SELECT difference FROM acc.v_control_reconciliation WHERE control_account = 'ลูกหนี้การค้า'), 0);
SELECT tst.expect_eq('T19b บัญชีคุมเจ้าหนี้ต้องตรงกับบัญชีย่อย',
       (SELECT difference FROM acc.v_control_reconciliation WHERE control_account = 'เจ้าหนี้การค้า'), 0);

SELECT tst.expect_eq('T20 งบทดลองเดือน ส.ค. ต้องมี Dr = Cr',
       (SELECT SUM(period_debit) - SUM(period_credit) FROM acc.fn_trial_balance(8)), 0);

-- =====================================================================
-- T21 · ปิดบัญชีสิ้นปี บัญชีสรุปต้องเป็นศูนย์
--       รายได้ 100,000 / ค่าใช้จ่าย 358,500 -> ขาดทุนสุทธิ 258,500
-- =====================================================================
SELECT tst.mk_je('CL-JE-001','2026-08-31','CLOSING','ปิดบัญชีรายได้เข้าบัญชีสรุป', $$[
  {"code":"4000","dr":100000,"d":"ปิดบัญชีรายได้"},
  {"code":"3200","cr":100000,"d":"สรุปผลกำไรขาดทุน"}
]$$::jsonb);

SELECT tst.mk_je('CL-JE-002','2026-08-31','CLOSING','ปิดบัญชีค่าใช้จ่ายเข้าบัญชีสรุป', $$[
  {"code":"3200","dr":358500,"d":"สรุปผลกำไรขาดทุน"},
  {"code":"5020","cr":50000,"d":"ปิดค่าจ้างผู้รับเหมาช่วง"},
  {"code":"5110","cr":300000,"d":"ปิดเงินเดือน"},
  {"code":"5112","cr":7500,"d":"ปิดประกันสังคมนายจ้าง"},
  {"code":"5160","cr":1000,"d":"ปิดค่าเสื่อมราคา"}
]$$::jsonb);

SELECT tst.mk_je('CL-JE-003','2026-08-31','CLOSING','โอนผลขาดทุนสุทธิเข้ากำไรสะสม', $$[
  {"code":"3100","dr":258500,"d":"กำไรสะสม (ขาดทุนสุทธิ)"},
  {"code":"3200","cr":258500,"d":"ล้างบัญชีสรุปผลกำไรขาดทุน"}
]$$::jsonb);

SELECT tst.expect_eq('T21a หลังปิดบัญชี: บัญชีสรุปผลกำไรขาดทุนต้องเป็น 0', tst.bal('3200'), 0);
SELECT tst.expect_eq('T21b หลังปิดบัญชี: รายได้ต้องเป็น 0',                tst.bal('4000'), 0);
SELECT tst.expect_eq('T21c หลังปิดบัญชี: เงินเดือนต้องเป็น 0',             tst.bal('5110'), 0);
SELECT tst.expect_eq('T21d หลังปิดบัญชี: กำไรสะสมขาดทุน 258,500',          tst.bal('3100'), 258500);

-- =====================================================================
-- T22-T23 · ฟังก์ชันปิดงวด
-- =====================================================================
SELECT tst.mk_je('JV-DRAFT-1','2026-08-31','MANUAL','ใบร่างค้างอยู่', $$[
  {"code":"1010","dr":50},{"code":"1020","cr":50}
]$$::jsonb, FALSE);

SELECT tst.expect_error('T22 ปิดงวดไม่ได้ถ้ายังมีใบร่างค้าง', $$
  SELECT acc.close_period(8, 2)
$$);

DELETE FROM acc.journal_entries WHERE entry_no = 'JV-DRAFT-1';

SELECT acc.close_period(8, 2);

SELECT tst.expect_eq('T23a ปิดงวดสำเร็จ สถานะเป็น CLOSED',
       (SELECT COUNT(*) FROM acc.accounting_periods WHERE period_name='2026-08' AND status='CLOSED'), 1);
SELECT tst.expect_eq('T23b บันทึกสแนปช็อตยอดคงเหลือแล้ว',
       (SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
          FROM acc.account_period_balances WHERE period_id = 8), 1);

SELECT tst.expect_error('T23c งวดที่ปิดแล้วต้องลงบัญชีเพิ่มไม่ได้', $$
  SELECT tst.mk_je('JV-AFTER-CLOSE','2026-08-31','MANUAL','แอบลงหลังปิดงวด', '[
    {"code":"1010","dr":10},{"code":"1020","cr":10}]'::jsonb)
$$);

-- =====================================================================
-- T24 · Audit log ต้องบันทึกทุกการเปลี่ยนแปลง
-- =====================================================================
SELECT tst.expect_eq('T24 Audit log บันทึกรายการบัญชีครบ',
       (SELECT CASE WHEN COUNT(*) >= 10 THEN 1 ELSE 0 END
          FROM acc.audit_log WHERE table_name = 'journal_entries'), 1);

-- =====================================================================
-- สรุปผล
-- =====================================================================
\echo ''
\echo '================ ผลการทดสอบ ================'
SELECT seq, status, label, detail FROM tst.results ORDER BY seq;

SELECT status, COUNT(*) AS จำนวน FROM tst.results GROUP BY status ORDER BY status;

DO $$
DECLARE v_fail INT;
BEGIN
    SELECT COUNT(*) INTO v_fail FROM tst.results WHERE status = 'FAIL';
    IF v_fail > 0 THEN
        RAISE EXCEPTION 'มีเทสต์ไม่ผ่าน % รายการ', v_fail;
    END IF;
    RAISE NOTICE 'เทสต์ผ่านทั้งหมด';
END $$;
