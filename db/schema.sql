-- =====================================================================
--  ระบบบัญชีคู่เต็มรูปแบบ (Double-Entry Accounting System)
--  ธุรกิจบริการ | TFRS for NPAEs | PostgreSQL 14+
--  ---------------------------------------------------------------
--  หลักการที่ schema นี้บังคับไว้ที่ระดับฐานข้อมูล (ไม่ใช่แค่ระดับแอป):
--    1. ทุก Journal Entry ต้อง SUM(debit) = SUM(credit)  -> constraint trigger (deferred)
--    2. Journal Entry ที่ POSTED แล้ว แก้/ลบไม่ได้ตลอดกาล -> immutability trigger
--    3. ห้ามลงบัญชีในงวดที่ไม่ใช่สถานะ OPEN            -> period guard trigger
--    4. ลงบัญชีได้เฉพาะบัญชี is_active + allow_posting  -> line guard trigger
--    5. จำนวนเงินเป็น NUMERIC(15,2) เท่านั้น ห้าม float ทุกกรณี
--
--  หมายเหตุการ deploy: รันไฟล์นี้ทั้งไฟล์ในทรานแซกชันเดียว (psql -1 -f schema.sql)
-- =====================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS acc;
SET search_path TO acc, public;

-- =====================================================================
-- 0. DOMAIN & ENUM
-- =====================================================================

-- ใช้ domain เพื่อกันการเผลอประกาศคอลัมน์เงินเป็น float/real/double
CREATE DOMAIN acc.money_amt AS NUMERIC(15,2) NOT NULL DEFAULT 0
    CONSTRAINT money_amt_finite CHECK (VALUE IS NOT NULL);
CREATE DOMAIN acc.rate_pct  AS NUMERIC(6,3);   -- อัตราร้อยละ เช่น 7.000, 3.000, 1.500

CREATE TYPE acc.account_type     AS ENUM ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE');
CREATE TYPE acc.normal_balance   AS ENUM ('DEBIT','CREDIT');
CREATE TYPE acc.period_status    AS ENUM ('OPEN','CLOSED','LOCKED');
CREATE TYPE acc.je_status        AS ENUM ('DRAFT','POSTED','VOID');
CREATE TYPE acc.cashflow_cat     AS ENUM ('OPERATING','INVESTING','FINANCING','CASH','NONE');
CREATE TYPE acc.vat_timing       AS ENUM ('ON_INVOICE','ON_PAYMENT','NONE');
CREATE TYPE acc.partner_kind     AS ENUM ('INDIVIDUAL','JURISTIC','GOVERNMENT','FOREIGN');
CREATE TYPE acc.doc_status       AS ENUM ('DRAFT','APPROVED','POSTED','PARTIAL_PAID','PAID','OVERDUE','CANCELLED');
CREATE TYPE acc.depreciation_method AS ENUM ('STRAIGHT_LINE','DECLINING_BALANCE');
CREATE TYPE acc.wht_form         AS ENUM ('PND1','PND2','PND3','PND53','PND54');

CREATE TYPE acc.je_source AS ENUM (
    'OPENING',          -- ยอดยกมาตั้งต้นระบบ
    'SALES_INVOICE',    -- ออกใบแจ้งหนี้
    'SALES_RECEIPT',    -- รับชำระเงิน + ออกใบกำกับภาษี/ใบเสร็จ
    'SALES_ADVANCE',    -- รับเงินล่วงหน้า/มัดจำ
    'CREDIT_NOTE',      -- ใบลดหนี้
    'DEBIT_NOTE',       -- ใบเพิ่มหนี้
    'PURCHASE_BILL',    -- ตั้งหนี้ผู้ขาย
    'PURCHASE_PAYMENT', -- จ่ายชำระ + หัก ณ ที่จ่าย
    'PAYROLL',          -- เงินเดือน (รับยอดสรุปจากระบบภายนอก)
    'DEPRECIATION',     -- ค่าเสื่อมราคา/ค่าตัดจำหน่าย
    'TAX_REMITTANCE',   -- นำส่ง ภพ.30 / ภงด.
    'BANK',             -- ค่าธรรมเนียม ดอกเบี้ย รายการธนาคารอื่น
    'ADJUSTMENT',       -- รายการปรับปรุงสิ้นงวด
    'REVERSAL',         -- รายการกลับบัญชี
    'CLOSING',          -- ปิดบัญชีสิ้นงวด/สิ้นปี
    'MANUAL'            -- ลงบัญชีมือ
);

-- =====================================================================
-- 1. ผู้ใช้งาน สิทธิ์ และค่าตั้งระบบ
-- =====================================================================

CREATE TABLE acc.app_users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    full_name     TEXT NOT NULL,
    email         TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE acc.roles (
    code        TEXT PRIMARY KEY,      -- CONTROLLER, SENIOR_ACCOUNTANT, AR_AP_CLERK, VIEWER, AUDITOR
    name_th     TEXT NOT NULL,
    description TEXT
);

CREATE TABLE acc.user_roles (
    user_id   BIGINT NOT NULL REFERENCES acc.app_users(id) ON DELETE CASCADE,
    role_code TEXT   NOT NULL REFERENCES acc.roles(code),
    PRIMARY KEY (user_id, role_code)
);

CREATE TABLE acc.system_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    description TEXT
);

INSERT INTO acc.roles (code, name_th, description) VALUES
 ('CONTROLLER',        'ผู้จัดการบัญชี',   'ปิดงวด แก้ผังบัญชี อนุมัติ JE ทุกประเภท'),
 ('SENIOR_ACCOUNTANT', 'นักบัญชีอาวุโส',  'สร้าง/แก้ JE ค่าเสื่อมราคา กระทบยอดธนาคาร'),
 ('AR_AP_CLERK',       'นักบัญชี AR/AP',  'ออกเอกสารขาย-ซื้อ บันทึกรับ-จ่ายเงิน'),
 ('VIEWER',            'ผู้บริหาร',        'ดูรายงานอย่างเดียว'),
 ('AUDITOR',           'ผู้ตรวจสอบ',       'ดูได้ทุกอย่าง + Audit Log');

INSERT INTO acc.system_settings (key, value, description) VALUES
 ('ENFORCE_MAKER_CHECKER', 'true',  'บังคับผู้สร้าง JE ต้องไม่ใช่คนเดียวกับผู้อนุมัติ (ตั้ง false ได้ถ้าทีมมีคนเดียว)'),
 ('COMPANY_TAX_ID',        '',      'เลขประจำตัวผู้เสียภาษี 13 หลักของกิจการ'),
 ('COMPANY_BRANCH_CODE',   '00000', 'รหัสสาขา (สำนักงานใหญ่ = 00000)'),
 ('VAT_RATE',              '7.000', 'อัตราภาษีมูลค่าเพิ่มปัจจุบัน'),
 ('ROUNDING_TOLERANCE',    '1.00',  'ผลต่างเศษสตางค์สูงสุดที่ยอมให้ปรับเข้าบัญชีผลต่าง (บาท)');

-- =====================================================================
-- 2. ปีบัญชีและงวดบัญชี  (แกนเวลา)
-- =====================================================================
-- เก็บวันที่เป็น ค.ศ. เสมอ แปลงเป็น พ.ศ. เฉพาะตอนแสดงผล/พิมพ์รายงาน

CREATE TABLE acc.fiscal_years (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    year_code  TEXT NOT NULL UNIQUE,          -- เช่น 'FY2026'
    start_date DATE NOT NULL,
    end_date   DATE NOT NULL,
    status     acc.period_status NOT NULL DEFAULT 'OPEN',
    CONSTRAINT fy_date_order CHECK (end_date > start_date)
);

CREATE TABLE acc.accounting_periods (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fiscal_year_id BIGINT NOT NULL REFERENCES acc.fiscal_years(id),
    period_no      SMALLINT NOT NULL,          -- 1-12 (13 = งวดปรับปรุงปิดปี)
    period_name    TEXT NOT NULL UNIQUE,       -- เช่น '2026-08'
    start_date     DATE NOT NULL,
    end_date       DATE NOT NULL,
    status         acc.period_status NOT NULL DEFAULT 'OPEN',
    closed_by      BIGINT REFERENCES acc.app_users(id),
    closed_at      TIMESTAMPTZ,
    CONSTRAINT period_date_order CHECK (end_date >= start_date),
    CONSTRAINT period_no_range   CHECK (period_no BETWEEN 1 AND 13),
    UNIQUE (fiscal_year_id, period_no)
);

-- กันงวดซ้อนทับกัน (ต้องมี btree_gist)
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE acc.accounting_periods
    ADD CONSTRAINT period_no_overlap
    EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&);

CREATE INDEX idx_periods_range ON acc.accounting_periods (start_date, end_date);

-- =====================================================================
-- 3. ผังบัญชี (แกนโครงสร้าง)
-- =====================================================================

CREATE TABLE acc.chart_of_accounts (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_code      TEXT NOT NULL UNIQUE,
    account_name      TEXT NOT NULL,
    account_name_en   TEXT,
    account_type      acc.account_type NOT NULL,
    account_subtype   TEXT,                    -- CURRENT_ASSET, NON_CURRENT_ASSET, COST_OF_SERVICE ฯลฯ
    normal_balance    acc.normal_balance NOT NULL,
    parent_account_id BIGINT REFERENCES acc.chart_of_accounts(id),
    -- allow_posting = FALSE สำหรับบัญชีหัวข้อ/บัญชีคุม ป้องกันยอดซ้ำซ้อนกับบัญชีลูก
    allow_posting     BOOLEAN NOT NULL DEFAULT TRUE,
    is_contra         BOOLEAN NOT NULL DEFAULT FALSE,
    -- ใช้จัดกลุ่มงบกระแสเงินสด (วิธีทางอ้อม)
    cashflow_category acc.cashflow_cat NOT NULL DEFAULT 'NONE',
    -- ใช้ map เข้าบรรทัดงบการเงินตามแบบกรมพัฒนาธุรกิจการค้า (TFRS for NPAEs)
    npae_report_line  TEXT,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT coa_no_self_parent CHECK (parent_account_id IS DISTINCT FROM id),
    -- ประเภทบัญชีต้องคู่กับ normal balance ที่ถูกต้อง (ยกเว้นบัญชีปรับมูลค่า contra)
    CONSTRAINT coa_normal_balance_matches CHECK (
        is_contra
        OR (account_type IN ('ASSET','EXPENSE')             AND normal_balance = 'DEBIT')
        OR (account_type IN ('LIABILITY','EQUITY','REVENUE') AND normal_balance = 'CREDIT')
    )
);

CREATE INDEX idx_coa_parent ON acc.chart_of_accounts (parent_account_id);
CREATE INDEX idx_coa_type   ON acc.chart_of_accounts (account_type, account_code);

-- ตารางแมป "บทบาททางบัญชี" -> บัญชีจริง
-- Posting Rule ในโค้ดอ้างถึง key เช่น 'AR_TRADE' ไม่ใช่รหัส 1100 ตรง ๆ
-- ทำให้เปลี่ยนผังบัญชีได้โดยไม่ต้องแก้โค้ด
CREATE TABLE acc.account_mappings (
    key         TEXT PRIMARY KEY,
    account_id  BIGINT NOT NULL REFERENCES acc.chart_of_accounts(id),
    description TEXT
);

-- =====================================================================
-- 4. ศูนย์ต้นทุน และคู่ค้า
-- =====================================================================

CREATE TABLE acc.cost_centers (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code      TEXT NOT NULL UNIQUE,
    name      TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- ลูกค้าและผู้ขายอยู่ตารางเดียวกัน เพราะ SME มักมีคู่ค้าที่เป็นทั้งสองฝั่ง
CREATE TABLE acc.business_partners (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    partner_code  TEXT NOT NULL UNIQUE,
    partner_name  TEXT NOT NULL,
    partner_kind  acc.partner_kind NOT NULL DEFAULT 'JURISTIC',
    is_customer   BOOLEAN NOT NULL DEFAULT FALSE,
    is_vendor     BOOLEAN NOT NULL DEFAULT FALSE,
    -- ข้อมูลบังคับสำหรับใบกำกับภาษีและรายงานภาษีซื้อ-ขาย ตามประกาศอธิบดีกรมสรรพากร
    tax_id        TEXT,
    branch_code   TEXT DEFAULT '00000',
    address_line  TEXT,
    is_vat_registered BOOLEAN NOT NULL DEFAULT TRUE,
    -- อัตราหัก ณ ที่จ่ายเริ่มต้นเมื่อจ่ายเงินให้คู่ค้ารายนี้ (บริการทั่วไป = 3)
    default_wht_rate  acc.rate_pct,
    default_wht_form  acc.wht_form,
    credit_days   SMALLINT NOT NULL DEFAULT 30,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT partner_must_have_role CHECK (is_customer OR is_vendor),
    CONSTRAINT partner_tax_id_format  CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{13}$'),
    CONSTRAINT partner_branch_format  CHECK (branch_code IS NULL OR branch_code ~ '^[0-9]{5}$')
);

CREATE INDEX idx_partner_customer ON acc.business_partners (is_customer) WHERE is_customer;
CREATE INDEX idx_partner_vendor   ON acc.business_partners (is_vendor)   WHERE is_vendor;

CREATE TABLE acc.bank_accounts (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_no     TEXT NOT NULL UNIQUE,
    bank_name      TEXT NOT NULL,
    branch_name    TEXT,
    account_name   TEXT NOT NULL,
    account_type   TEXT,                       -- CURRENT / SAVINGS / FIXED
    gl_account_id  BIGINT NOT NULL REFERENCES acc.chart_of_accounts(id),
    is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- =====================================================================
-- 5. เลขที่เอกสาร (ต้องเรียงลำดับ ห้ามซ้ำ ห้ามข้าม)
-- =====================================================================

CREATE TABLE acc.document_sequences (
    doc_type    TEXT NOT NULL,          -- INV, RC, CN, DN, PV, JV, BL ...
    year_key    TEXT NOT NULL,          -- 'YYYY' หรือ 'YYYYMM' ตาม reset_cycle
    prefix      TEXT NOT NULL,
    pad_length  SMALLINT NOT NULL DEFAULT 5,
    last_number BIGINT NOT NULL DEFAULT 0,
    reset_cycle TEXT NOT NULL DEFAULT 'YEARLY',   -- YEARLY | MONTHLY | NEVER
    PRIMARY KEY (doc_type, year_key)
);

-- ออกเลขที่เอกสารแบบ concurrency-safe (ห้ามใช้ MAX(no)+1 เด็ดขาด)
CREATE OR REPLACE FUNCTION acc.next_doc_no(p_doc_type TEXT, p_date DATE)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
    v_cycle   TEXT;
    v_yearkey TEXT;
    v_row     acc.document_sequences%ROWTYPE;
BEGIN
    SELECT reset_cycle INTO v_cycle
      FROM acc.document_sequences
     WHERE doc_type = p_doc_type
     LIMIT 1;

    IF v_cycle IS NULL THEN
        RAISE EXCEPTION 'ยังไม่ได้ตั้งค่าลำดับเลขที่เอกสารประเภท %', p_doc_type;
    END IF;

    v_yearkey := CASE v_cycle
                    WHEN 'MONTHLY' THEN to_char(p_date, 'YYYYMM')
                    WHEN 'YEARLY'  THEN to_char(p_date, 'YYYY')
                    ELSE 'ALL'
                 END;

    -- UPDATE ... RETURNING ล็อกแถวไว้จนจบทรานแซกชัน จึงกันการชนกันได้จริง
    UPDATE acc.document_sequences
       SET last_number = last_number + 1
     WHERE doc_type = p_doc_type AND year_key = v_yearkey
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        INSERT INTO acc.document_sequences (doc_type, year_key, prefix, pad_length, last_number, reset_cycle)
        SELECT p_doc_type, v_yearkey, prefix, pad_length, 1, reset_cycle
          FROM acc.document_sequences WHERE doc_type = p_doc_type LIMIT 1
        RETURNING * INTO v_row;
    END IF;

    RETURN v_row.prefix
         || CASE WHEN v_cycle = 'NEVER' THEN '' ELSE v_yearkey || '-' END
         || lpad(v_row.last_number::TEXT, v_row.pad_length, '0');
END $$;

-- =====================================================================
-- 6. สมุดรายวันทั่วไป  (แกนความจริง — Single Source of Truth)
-- =====================================================================

CREATE TABLE acc.journal_entries (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entry_no      TEXT NOT NULL UNIQUE,
    entry_date    DATE NOT NULL,
    period_id     BIGINT NOT NULL REFERENCES acc.accounting_periods(id),
    source_type   acc.je_source NOT NULL,
    -- อ้างอิงเอกสารต้นทางแบบ polymorphic: ต้องระบุชื่อตารางคู่กับ id เสมอ
    source_table  TEXT,
    source_doc_id BIGINT,
    description   TEXT NOT NULL,
    status        acc.je_status NOT NULL DEFAULT 'DRAFT',
    -- การกลับรายการ: JE ที่ POSTED ห้ามแก้ ต้องออกใบกลับบัญชีเท่านั้น
    reverses_entry_id    BIGINT REFERENCES acc.journal_entries(id),
    reversed_by_entry_id BIGINT REFERENCES acc.journal_entries(id),
    created_by    BIGINT NOT NULL REFERENCES acc.app_users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by   BIGINT REFERENCES acc.app_users(id),
    posted_at     TIMESTAMPTZ,
    CONSTRAINT je_source_ref_complete CHECK (
        (source_table IS NULL AND source_doc_id IS NULL)
     OR (source_table IS NOT NULL AND source_doc_id IS NOT NULL)),
    CONSTRAINT je_posted_needs_approver CHECK (
        status <> 'POSTED' OR (approved_by IS NOT NULL AND posted_at IS NOT NULL)),
    CONSTRAINT je_no_self_reversal CHECK (reverses_entry_id IS DISTINCT FROM id)
);

CREATE INDEX idx_je_date    ON acc.journal_entries (entry_date);
CREATE INDEX idx_je_period  ON acc.journal_entries (period_id, status);
CREATE INDEX idx_je_source  ON acc.journal_entries (source_table, source_doc_id);
CREATE INDEX idx_je_status  ON acc.journal_entries (status) WHERE status = 'DRAFT';

CREATE TABLE acc.journal_entry_lines (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    journal_entry_id BIGINT NOT NULL REFERENCES acc.journal_entries(id) ON DELETE CASCADE,
    line_no          SMALLINT NOT NULL,
    account_id       BIGINT NOT NULL REFERENCES acc.chart_of_accounts(id),
    debit_amount     acc.money_amt NOT NULL DEFAULT 0,
    credit_amount    acc.money_amt NOT NULL DEFAULT 0,
    description      TEXT,
    cost_center_id   BIGINT REFERENCES acc.cost_centers(id),
    partner_id       BIGINT REFERENCES acc.business_partners(id),  -- ใช้ทำ sub-ledger รายตัว
    reference_doc    TEXT,
    UNIQUE (journal_entry_id, line_no),
    -- แต่ละบรรทัดต้องเป็นเดบิตหรือเครดิตอย่างใดอย่างหนึ่งเท่านั้น และต้องมากกว่าศูนย์
    CONSTRAINT jel_one_side_only CHECK (
        debit_amount >= 0 AND credit_amount >= 0
        AND (debit_amount > 0) <> (credit_amount > 0))
);

CREATE INDEX idx_jel_entry   ON acc.journal_entry_lines (journal_entry_id);
CREATE INDEX idx_jel_account ON acc.journal_entry_lines (account_id);
CREATE INDEX idx_jel_partner ON acc.journal_entry_lines (partner_id) WHERE partner_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 6.1 กฎเหล็กข้อ 1: Dr = Cr  (constraint trigger แบบ DEFERRED)
-- ---------------------------------------------------------------------
-- ต้องเป็น DEFERRED เพราะระหว่างการ INSERT ทีละบรรทัด ยอดย่อมไม่สมดุลชั่วคราว
-- การตรวจจะเกิดขึ้น ณ เวลา COMMIT เท่านั้น
CREATE OR REPLACE FUNCTION acc.fn_je_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_entry_id BIGINT;
    v_status   acc.je_status;
    v_dr NUMERIC(18,2);
    v_cr NUMERIC(18,2);
    v_cnt INT;
BEGIN
    -- ฟังก์ชันนี้ถูกใช้กับสองตาราง จึงต้องแยกวิธีหา entry_id
    -- (ห้ามอ้าง NEW ในเหตุการณ์ DELETE เพราะ record ยังไม่ถูกกำหนดค่า)
    IF TG_TABLE_NAME = 'journal_entry_lines' THEN
        IF TG_OP = 'DELETE' THEN v_entry_id := OLD.journal_entry_id;
        ELSE                     v_entry_id := NEW.journal_entry_id;
        END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN v_entry_id := OLD.id;
        ELSE                     v_entry_id := NEW.id;
        END IF;
    END IF;

    SELECT status INTO v_status FROM acc.journal_entries WHERE id = v_entry_id;

    -- หัวใบถูกลบไปแล้ว ไม่ต้องตรวจ
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- ตรวจเฉพาะใบที่ลงบัญชีจริง — ใบร่างระหว่างแก้ไขยังไม่สมดุลได้เป็นเรื่องปกติ
    IF v_status <> 'POSTED' THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(SUM(debit_amount),0), COALESCE(SUM(credit_amount),0), COUNT(*)
      INTO v_dr, v_cr, v_cnt
      FROM acc.journal_entry_lines
     WHERE journal_entry_id = v_entry_id;

    IF v_cnt < 2 THEN
        RAISE EXCEPTION 'JE id=% : รายการบัญชีต้องมีอย่างน้อย 2 บรรทัด (พบ %)', v_entry_id, v_cnt
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_dr <> v_cr THEN
        RAISE EXCEPTION 'JE id=% ไม่สมดุล: เดบิต % <> เครดิต % (ผลต่าง %)',
            v_entry_id, v_dr, v_cr, (v_dr - v_cr)
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_jel_balanced
    AFTER INSERT OR UPDATE OR DELETE ON acc.journal_entry_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION acc.fn_je_balanced();

-- ตรวจซ้ำที่หัวใบ กันกรณีสร้าง JE โดยไม่ใส่บรรทัดเลย
CREATE CONSTRAINT TRIGGER trg_je_has_balanced_lines
    AFTER INSERT OR UPDATE ON acc.journal_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION acc.fn_je_balanced();

-- ---------------------------------------------------------------------
-- 6.2 กฎเหล็กข้อ 3: หางวดอัตโนมัติ + ห้ามลงบัญชีในงวดที่ปิดแล้ว
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION acc.fn_je_period_guard()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_period   acc.accounting_periods%ROWTYPE;
    v_enforce  BOOLEAN;
BEGIN
    -- บังคับให้สร้างเป็นใบร่างก่อนเสมอ แล้วจึงเปลี่ยนสถานะเป็น POSTED หลังใส่บรรทัดครบ
    -- (จำเป็น เพราะ trigger ความคงทนห้ามเพิ่มบรรทัดให้ใบที่ POSTED แล้ว)
    IF TG_OP = 'INSERT' AND NEW.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'ต้องสร้างรายการบัญชีเป็นสถานะ DRAFT ก่อน แล้วจึงเปลี่ยนเป็น POSTED เมื่อใส่บรรทัดครบแล้ว'
            USING ERRCODE = 'check_violation';
    END IF;

    -- การแก้ไขที่ไม่กระทบตัวเลขและไม่ย้ายงวด (เช่น ผูกใบกลับบัญชีย้อนไปยังงวดที่ปิดแล้ว)
    -- ต้องทำได้ มิฉะนั้นจะบันทึกการกลับรายการข้ามงวดไม่ได้เลย
    IF TG_OP = 'UPDATE'
       AND NEW.entry_date = OLD.entry_date
       AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_period
      FROM acc.accounting_periods
     WHERE NEW.entry_date BETWEEN start_date AND end_date;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ไม่พบงวดบัญชีที่ครอบคลุมวันที่ %', NEW.entry_date
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    NEW.period_id := v_period.id;   -- กำหนดงวดจากวันที่เสมอ ไม่เชื่อค่าที่แอปส่งมา

    IF v_period.status <> 'OPEN' THEN
        RAISE EXCEPTION 'งวด % สถานะ % : ห้ามบันทึกหรือแก้ไขรายการบัญชี',
            v_period.period_name, v_period.status
            USING ERRCODE = 'check_violation';
    END IF;

    -- แยกหน้าที่ผู้สร้างกับผู้อนุมัติ (ปิดได้ผ่าน system_settings ถ้าทีมมีคนเดียว)
    IF NEW.status = 'POSTED' THEN
        SELECT value = 'true' INTO v_enforce
          FROM acc.system_settings WHERE key = 'ENFORCE_MAKER_CHECKER';
        IF COALESCE(v_enforce, FALSE) AND NEW.approved_by = NEW.created_by THEN
            RAISE EXCEPTION 'ผู้อนุมัติต้องไม่ใช่คนเดียวกับผู้บันทึก (JE %)', NEW.entry_no
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.posted_at IS NULL THEN
            NEW.posted_at := now();
        END IF;
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER trg_je_period_guard
    BEFORE INSERT OR UPDATE ON acc.journal_entries
    FOR EACH ROW EXECUTE FUNCTION acc.fn_je_period_guard();

-- ---------------------------------------------------------------------
-- 6.3 กฎเหล็กข้อ 2: JE ที่ POSTED แล้ว ห้ามแก้ ห้ามลบ
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION acc.fn_je_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'POSTED' THEN
            RAISE EXCEPTION 'ห้ามลบ JE ที่ลงบัญชีแล้ว (%) — ต้องสร้างรายการกลับบัญชีแทน', OLD.entry_no
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.status = 'POSTED' THEN
        -- อนุญาตให้เปลี่ยนได้เฉพาะการผูกใบกลับบัญชีเท่านั้น
        IF ROW(NEW.entry_no, NEW.entry_date, NEW.source_type, NEW.description,
               NEW.status, NEW.created_by, NEW.approved_by, NEW.posted_at)
           IS DISTINCT FROM
           ROW(OLD.entry_no, OLD.entry_date, OLD.source_type, OLD.description,
               OLD.status, OLD.created_by, OLD.approved_by, OLD.posted_at)
        THEN
            RAISE EXCEPTION 'ห้ามแก้ไข JE ที่ลงบัญชีแล้ว (%) — แก้ได้เฉพาะการอ้างอิงใบกลับบัญชี', OLD.entry_no
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER trg_je_immutable
    BEFORE UPDATE OR DELETE ON acc.journal_entries
    FOR EACH ROW EXECUTE FUNCTION acc.fn_je_immutable();

-- บรรทัดของ JE ที่ POSTED แล้ว ห้ามแตะทั้งสิ้น
CREATE OR REPLACE FUNCTION acc.fn_jel_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_status acc.je_status;
    v_id     BIGINT;
BEGIN
    -- อ้าง OLD เฉพาะตอน DELETE เท่านั้น มิฉะนั้น record จะยังไม่ถูกกำหนดค่า
    IF TG_OP = 'DELETE' THEN v_id := OLD.journal_entry_id;
    ELSE                     v_id := NEW.journal_entry_id;
    END IF;

    SELECT status INTO v_status FROM acc.journal_entries WHERE id = v_id;

    -- ถ้าหัวใบกำลังถูกลบทั้งใบ (cascade) ให้ผ่าน
    IF FOUND AND v_status = 'POSTED' THEN
        RAISE EXCEPTION 'ห้ามเพิ่ม/แก้/ลบบรรทัดของ JE ที่ลงบัญชีแล้ว (id=%)', v_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_jel_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON acc.journal_entry_lines
    FOR EACH ROW EXECUTE FUNCTION acc.fn_jel_immutable();

-- ---------------------------------------------------------------------
-- 6.4 กฎเหล็กข้อ 4: ลงได้เฉพาะบัญชีที่เปิดใช้งานและอนุญาตให้ post
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION acc.fn_jel_account_guard()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_acc acc.chart_of_accounts%ROWTYPE;
BEGIN
    SELECT * INTO v_acc FROM acc.chart_of_accounts WHERE id = NEW.account_id;

    IF NOT v_acc.is_active THEN
        RAISE EXCEPTION 'บัญชี % (%) ถูกปิดใช้งานแล้ว', v_acc.account_code, v_acc.account_name
            USING ERRCODE = 'check_violation';
    END IF;

    IF NOT v_acc.allow_posting THEN
        RAISE EXCEPTION 'บัญชี % (%) เป็นบัญชีคุม/หัวข้อ ห้ามลงรายการโดยตรง',
            v_acc.account_code, v_acc.account_name
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER trg_jel_account_guard
    BEFORE INSERT OR UPDATE ON acc.journal_entry_lines
    FOR EACH ROW EXECUTE FUNCTION acc.fn_jel_account_guard();

-- ---------------------------------------------------------------------
-- 6.5 Journal Engine ระดับฐานข้อมูล
-- ---------------------------------------------------------------------
-- ห่อลำดับ DRAFT -> ใส่บรรทัด -> POSTED ไว้ในฟังก์ชันเดียว
-- ทุกโมดูลควรลงบัญชีผ่านฟังก์ชันนี้ ไม่ INSERT ตารางตรง ๆ
--
-- ตัวอย่าง:
--   SELECT acc.post_journal_entry(
--       'INV-JE-00001', DATE '2026-08-05', 'SALES_INVOICE', 'ออกใบแจ้งหนี้ INV2026-00001',
--       '[{"code":"1100","dr":107000,"partner_id":1},
--         {"code":"4000","cr":100000},
--         {"code":"2101","cr":7000}]'::jsonb,
--       1, 2, 'ar_invoices', 1);
--
-- คีย์ที่ใช้ได้ในแต่ละบรรทัด: code (บังคับ), dr, cr, memo, partner_id, cost_center_id, ref
CREATE OR REPLACE FUNCTION acc.post_journal_entry(
    p_entry_no      TEXT,
    p_entry_date    DATE,
    p_source        acc.je_source,
    p_description   TEXT,
    p_lines         JSONB,
    p_created_by    BIGINT,
    p_approved_by   BIGINT,
    p_source_table  TEXT   DEFAULT NULL,
    p_source_doc_id BIGINT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
    v_id   BIGINT;
    v_line JSONB;
    v_i    SMALLINT := 0;
    v_acc  BIGINT;
BEGIN
    IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
        RAISE EXCEPTION 'ต้องระบุบรรทัดรายการบัญชีอย่างน้อย 2 บรรทัด'
            USING ERRCODE = 'check_violation';
    END IF;

    -- ขั้นที่ 1: สร้างหัวใบเป็นใบร่าง (period_id ถูกกำหนดใหม่โดย trigger จาก entry_date)
    INSERT INTO acc.journal_entries
        (entry_no, entry_date, period_id, source_type, source_table, source_doc_id,
         description, status, created_by)
    VALUES (p_entry_no, p_entry_date, 1, p_source, p_source_table, p_source_doc_id,
            p_description, 'DRAFT', p_created_by)
    RETURNING id INTO v_id;

    -- ขั้นที่ 2: ใส่บรรทัดให้ครบก่อน
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_i := v_i + 1;

        SELECT id INTO v_acc
          FROM acc.chart_of_accounts
         WHERE account_code = v_line->>'code';

        IF v_acc IS NULL THEN
            RAISE EXCEPTION 'ไม่พบบัญชีรหัส % (บรรทัดที่ %)', v_line->>'code', v_i
                USING ERRCODE = 'foreign_key_violation';
        END IF;

        INSERT INTO acc.journal_entry_lines
            (journal_entry_id, line_no, account_id, debit_amount, credit_amount,
             description, partner_id, cost_center_id, reference_doc)
        VALUES (v_id, v_i, v_acc,
                COALESCE((v_line->>'dr')::NUMERIC, 0),
                COALESCE((v_line->>'cr')::NUMERIC, 0),
                v_line->>'memo',
                (v_line->>'partner_id')::BIGINT,
                (v_line->>'cost_center_id')::BIGINT,
                v_line->>'ref');
    END LOOP;

    -- ขั้นที่ 3: ลงบัญชีจริง
    UPDATE acc.journal_entries
       SET status = 'POSTED', approved_by = p_approved_by
     WHERE id = v_id;

    -- บังคับตรวจสมดุลทันที เพื่อให้ผู้เรียกได้รับ error ตรงจุดที่ผิด
    -- ไม่ต้องรอจนถึงจังหวะ COMMIT ซึ่งไล่หาต้นตอยาก
    SET CONSTRAINTS ALL IMMEDIATE;

    RETURN v_id;
END $$;

COMMENT ON FUNCTION acc.post_journal_entry IS
 'ลงบัญชีหนึ่งใบแบบ atomic — ทุกโมดูลควรเรียกฟังก์ชันนี้แทนการ INSERT ตารางโดยตรง';

-- สร้างใบกลับบัญชีจากใบเดิม (วิธีเดียวที่ยกเลิกรายการที่ POSTED แล้วได้)
CREATE OR REPLACE FUNCTION acc.reverse_journal_entry(
    p_entry_id     BIGINT,
    p_reversal_no  TEXT,
    p_reversal_date DATE,
    p_created_by   BIGINT,
    p_approved_by  BIGINT,
    p_reason       TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
    v_src   acc.journal_entries%ROWTYPE;
    v_new   BIGINT;
    v_lines JSONB;
BEGIN
    SELECT * INTO v_src FROM acc.journal_entries WHERE id = p_entry_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ไม่พบรายการบัญชี id=%', p_entry_id;
    END IF;
    IF v_src.status <> 'POSTED' THEN
        RAISE EXCEPTION 'กลับบัญชีได้เฉพาะใบที่ลงบัญชีแล้ว (สถานะปัจจุบัน %)', v_src.status;
    END IF;
    IF v_src.reversed_by_entry_id IS NOT NULL THEN
        RAISE EXCEPTION 'ใบ % ถูกกลับบัญชีไปแล้วด้วยใบ id=%', v_src.entry_no, v_src.reversed_by_entry_id;
    END IF;

    -- สลับด้านเดบิต-เครดิตทุกบรรทัด
    SELECT jsonb_agg(jsonb_build_object(
               'code', c.account_code,
               'dr',   l.credit_amount,
               'cr',   l.debit_amount,
               'memo', COALESCE(l.description,'') || ' (กลับรายการ)',
               'partner_id', l.partner_id,
               'cost_center_id', l.cost_center_id,
               'ref',  l.reference_doc)
           ORDER BY l.line_no)
      INTO v_lines
      FROM acc.journal_entry_lines l
      JOIN acc.chart_of_accounts c ON c.id = l.account_id
     WHERE l.journal_entry_id = p_entry_id;

    v_new := acc.post_journal_entry(
        p_reversal_no, p_reversal_date, 'REVERSAL',
        COALESCE(p_reason, 'กลับรายการใบ ' || v_src.entry_no),
        v_lines, p_created_by, p_approved_by);

    UPDATE acc.journal_entries SET reverses_entry_id    = p_entry_id WHERE id = v_new;
    UPDATE acc.journal_entries SET reversed_by_entry_id = v_new      WHERE id = p_entry_id;

    RETURN v_new;
END $$;

-- =====================================================================
-- 7. ลูกหนี้ / รายรับ  (AR Sub-ledger)
-- =====================================================================
-- สำคัญ: ธุรกิจบริการ -> จุดรับผิดทาง VAT เกิดเมื่อ "รับชำระเงิน"
--        ตอนออกใบแจ้งหนี้จึงลง "พักภาษีขาย" ก่อน แล้วโอนเป็นภาษีขายจริงตอนรับเงิน

CREATE TABLE acc.ar_invoices (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doc_no         TEXT NOT NULL UNIQUE,
    customer_id    BIGINT NOT NULL REFERENCES acc.business_partners(id),
    quotation_ref  TEXT,
    issue_date     DATE NOT NULL,
    due_date       DATE NOT NULL,
    subtotal       acc.money_amt NOT NULL DEFAULT 0,
    discount_amount acc.money_amt NOT NULL DEFAULT 0,
    vat_base       acc.money_amt NOT NULL DEFAULT 0,
    vat_amount     acc.money_amt NOT NULL DEFAULT 0,
    total_amount   acc.money_amt NOT NULL DEFAULT 0,
    -- อัตราหัก ณ ที่จ่ายที่คาดว่าลูกค้าจะหัก (บริการ = 3%) ใช้ประมาณการกระแสเงินสด
    expected_wht_rate acc.rate_pct,
    paid_amount    acc.money_amt NOT NULL DEFAULT 0,
    balance_due    acc.money_amt NOT NULL DEFAULT 0,
    status         acc.doc_status NOT NULL DEFAULT 'DRAFT',
    journal_entry_id BIGINT REFERENCES acc.journal_entries(id),
    created_by     BIGINT NOT NULL REFERENCES acc.app_users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT inv_due_after_issue CHECK (due_date >= issue_date),
    CONSTRAINT inv_total_consistent CHECK (total_amount = subtotal - discount_amount + vat_amount),
    CONSTRAINT inv_balance_consistent CHECK (balance_due = total_amount - paid_amount),
    CONSTRAINT inv_paid_not_over CHECK (paid_amount <= total_amount)
);

CREATE INDEX idx_inv_customer ON acc.ar_invoices (customer_id, status);
CREATE INDEX idx_inv_open     ON acc.ar_invoices (due_date) WHERE balance_due > 0;

-- แตกเป็นบรรทัดจริง ไม่ใช่ JSON เพื่อให้ทำรายงานแยกบริการ/แยกอัตราภาษี/แยกแผนกได้
CREATE TABLE acc.ar_invoice_lines (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id     BIGINT NOT NULL REFERENCES acc.ar_invoices(id) ON DELETE CASCADE,
    line_no        SMALLINT NOT NULL,
    description    TEXT NOT NULL,
    quantity       NUMERIC(12,3) NOT NULL DEFAULT 1,
    unit_price     acc.money_amt NOT NULL DEFAULT 0,
    line_amount    acc.money_amt NOT NULL DEFAULT 0,
    revenue_account_id BIGINT NOT NULL REFERENCES acc.chart_of_accounts(id),
    vat_rate       acc.rate_pct NOT NULL DEFAULT 7,
    vat_amount     acc.money_amt NOT NULL DEFAULT 0,
    cost_center_id BIGINT REFERENCES acc.cost_centers(id),
    UNIQUE (invoice_id, line_no)
);

CREATE TABLE acc.ar_receipts (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doc_no           TEXT NOT NULL UNIQUE,
    customer_id      BIGINT NOT NULL REFERENCES acc.business_partners(id),
    receipt_date     DATE NOT NULL,
    -- เลขที่ใบกำกับภาษีออก ณ วันรับเงิน (ธุรกิจบริการ)
    tax_invoice_no   TEXT UNIQUE,
    tax_invoice_date DATE,
    gross_amount     acc.money_amt NOT NULL DEFAULT 0,  -- ยอดรวมที่ตัดหนี้ลูกหนี้
    wht_amount       acc.money_amt NOT NULL DEFAULT 0,  -- ที่ลูกค้าหักจากเรา
    fee_amount       acc.money_amt NOT NULL DEFAULT 0,  -- ค่าธรรมเนียมโอน (ถ้าฝ่ายเรารับภาระ)
    net_received     acc.money_amt NOT NULL DEFAULT 0,  -- เงินเข้าบัญชีจริง
    payment_method   TEXT NOT NULL DEFAULT 'TRANSFER',
    bank_account_id  BIGINT REFERENCES acc.bank_accounts(id),
    status           acc.doc_status NOT NULL DEFAULT 'DRAFT',
    journal_entry_id BIGINT REFERENCES acc.journal_entries(id),
    created_by       BIGINT NOT NULL REFERENCES acc.app_users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT rc_net_consistent CHECK (net_received = gross_amount - wht_amount - fee_amount)
);

-- รับเงินก้อนเดียวปิดได้หลายใบแจ้งหนี้ และใบแจ้งหนี้ใบเดียวรับได้หลายงวด
CREATE TABLE acc.ar_receipt_allocations (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receipt_id    BIGINT NOT NULL REFERENCES acc.ar_receipts(id) ON DELETE CASCADE,
    invoice_id    BIGINT NOT NULL REFERENCES acc.ar_invoices(id),
    applied_amount acc.money_amt NOT NULL,
    wht_amount     acc.money_amt NOT NULL DEFAULT 0,
    UNIQUE (receipt_id, invoice_id),
    CONSTRAINT alloc_positive CHECK (applied_amount > 0)
);

-- ใบลดหนี้ / ใบเพิ่มหนี้ (กฎหมาย VAT บังคับ ใช้ VOID แทนไม่ได้)
CREATE TABLE acc.ar_credit_notes (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doc_no           TEXT NOT NULL UNIQUE,
    note_type        TEXT NOT NULL DEFAULT 'CREDIT',  -- CREDIT = ใบลดหนี้, DEBIT = ใบเพิ่มหนี้
    customer_id      BIGINT NOT NULL REFERENCES acc.business_partners(id),
    original_invoice_id BIGINT REFERENCES acc.ar_invoices(id),
    original_tax_invoice_no TEXT,
    issue_date       DATE NOT NULL,
    reason           TEXT NOT NULL,
    base_amount      acc.money_amt NOT NULL DEFAULT 0,
    vat_amount       acc.money_amt NOT NULL DEFAULT 0,
    total_amount     acc.money_amt NOT NULL DEFAULT 0,
    status           acc.doc_status NOT NULL DEFAULT 'DRAFT',
    journal_entry_id BIGINT REFERENCES acc.journal_entries(id),
    CONSTRAINT cn_type_valid CHECK (note_type IN ('CREDIT','DEBIT')),
    CONSTRAINT cn_total_consistent CHECK (total_amount = base_amount + vat_amount)
);

-- หนังสือรับรองหัก ณ ที่จ่ายที่ "เราได้รับจากลูกค้า" -> เครดิตภาษีตอนยื่น ภงด.50
CREATE TABLE acc.wht_received (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id    BIGINT NOT NULL REFERENCES acc.business_partners(id),
    receipt_id     BIGINT REFERENCES acc.ar_receipts(id),
    certificate_no TEXT,
    issue_date     DATE NOT NULL,
    fiscal_year_id BIGINT NOT NULL REFERENCES acc.fiscal_years(id),
    base_amount    acc.money_amt NOT NULL,
    wht_rate       acc.rate_pct NOT NULL,
    wht_amount     acc.money_amt NOT NULL,
    is_document_received BOOLEAN NOT NULL DEFAULT FALSE,  -- ได้รับเอกสารตัวจริงแล้วหรือยัง
    file_url       TEXT
);

CREATE INDEX idx_wht_recv_pending ON acc.wht_received (customer_id)
    WHERE NOT is_document_received;

-- =====================================================================
-- 8. เจ้าหนี้ / รายจ่าย  (AP Sub-ledger)
-- =====================================================================

CREATE TABLE acc.ap_bills (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doc_no         TEXT NOT NULL UNIQUE,
    vendor_id      BIGINT NOT NULL REFERENCES acc.business_partners(id),
    po_ref         TEXT,
    vendor_invoice_no TEXT,
    bill_date      DATE NOT NULL,
    due_date       DATE NOT NULL,
    subtotal       acc.money_amt NOT NULL DEFAULT 0,
    vat_amount     acc.money_amt NOT NULL DEFAULT 0,
    total_amount   acc.money_amt NOT NULL DEFAULT 0,
    -- ON_PAYMENT = ค่าบริการ (ใบกำกับภาษีได้ตอนจ่าย -> ลงพักภาษีซื้อก่อน)
    -- ON_INVOICE = ค่าสินค้า (ได้ใบกำกับภาษีพร้อมของ -> ลงภาษีซื้อได้ทันที)
    vat_timing     acc.vat_timing NOT NULL DEFAULT 'ON_PAYMENT',
    wht_rate       acc.rate_pct,
    wht_form       acc.wht_form,
    estimated_wht  acc.money_amt NOT NULL DEFAULT 0,
    paid_amount    acc.money_amt NOT NULL DEFAULT 0,
    balance_due    acc.money_amt NOT NULL DEFAULT 0,
    status         acc.doc_status NOT NULL DEFAULT 'DRAFT',
    journal_entry_id BIGINT REFERENCES acc.journal_entries(id),
    created_by     BIGINT NOT NULL REFERENCES acc.app_users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT bill_total_consistent   CHECK (total_amount = subtotal + vat_amount),
    CONSTRAINT bill_balance_consistent CHECK (balance_due = total_amount - paid_amount)
);

CREATE INDEX idx_bill_vendor ON acc.ap_bills (vendor_id, status);
CREATE INDEX idx_bill_open   ON acc.ap_bills (due_date) WHERE balance_due > 0;

CREATE TABLE acc.ap_bill_lines (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bill_id        BIGINT NOT NULL REFERENCES acc.ap_bills(id) ON DELETE CASCADE,
    line_no        SMALLINT NOT NULL,
    description    TEXT NOT NULL,
    line_amount    acc.money_amt NOT NULL DEFAULT 0,
    -- บัญชีปลายทาง: ค่าใช้จ่าย (5xxx) หรือสินทรัพย์ (1xxx) แล้วแต่รายการ
    expense_account_id BIGINT NOT NULL REFERENCES acc.chart_of_accounts(id),
    vat_rate       acc.rate_pct NOT NULL DEFAULT 7,
    vat_amount     acc.money_amt NOT NULL DEFAULT 0,
    wht_rate       acc.rate_pct,                     -- อัตราหัก ณ ที่จ่ายต่างกันได้ในใบเดียว
    cost_center_id BIGINT REFERENCES acc.cost_centers(id),
    UNIQUE (bill_id, line_no)
);

CREATE TABLE acc.ap_payments (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doc_no           TEXT NOT NULL UNIQUE,
    vendor_id        BIGINT NOT NULL REFERENCES acc.business_partners(id),
    payment_date     DATE NOT NULL,
    gross_amount     acc.money_amt NOT NULL DEFAULT 0,
    wht_amount       acc.money_amt NOT NULL DEFAULT 0,
    net_paid         acc.money_amt NOT NULL DEFAULT 0,
    payment_method   TEXT NOT NULL DEFAULT 'TRANSFER',
    bank_account_id  BIGINT REFERENCES acc.bank_accounts(id),
    status           acc.doc_status NOT NULL DEFAULT 'DRAFT',
    journal_entry_id BIGINT REFERENCES acc.journal_entries(id),
    created_by       BIGINT NOT NULL REFERENCES acc.app_users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pay_net_consistent CHECK (net_paid = gross_amount - wht_amount)
);

CREATE TABLE acc.ap_payment_allocations (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id     BIGINT NOT NULL REFERENCES acc.ap_payments(id) ON DELETE CASCADE,
    bill_id        BIGINT NOT NULL REFERENCES acc.ap_bills(id),
    applied_amount acc.money_amt NOT NULL,
    wht_amount     acc.money_amt NOT NULL DEFAULT 0,
    UNIQUE (payment_id, bill_id),
    CONSTRAINT ap_alloc_positive CHECK (applied_amount > 0)
);

-- หนังสือรับรองหัก ณ ที่จ่ายที่ "เราออกให้ผู้ขาย"
CREATE TABLE acc.wht_certificates (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doc_no         TEXT NOT NULL UNIQUE,
    payment_id     BIGINT REFERENCES acc.ap_payments(id),
    payee_id       BIGINT NOT NULL REFERENCES acc.business_partners(id),
    issue_date     DATE NOT NULL,
    period_id      BIGINT NOT NULL REFERENCES acc.accounting_periods(id),
    wht_form       acc.wht_form NOT NULL,
    income_type    TEXT NOT NULL,          -- ประเภทเงินได้ตามแบบ เช่น '40(2)', '40(8)'
    base_amount    acc.money_amt NOT NULL,
    wht_rate       acc.rate_pct NOT NULL,
    wht_amount     acc.money_amt NOT NULL,
    is_remitted    BOOLEAN NOT NULL DEFAULT FALSE,
    pdf_url        TEXT
);

CREATE INDEX idx_wht_cert_period ON acc.wht_certificates (period_id, wht_form);

-- =====================================================================
-- 9. เงินเดือน (รับยอดสรุปจากระบบภายนอก แล้ว post เป็น JE ก้อนเดียว)
-- =====================================================================

CREATE TABLE acc.payroll_batches (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doc_no             TEXT NOT NULL UNIQUE,
    period_id          BIGINT NOT NULL REFERENCES acc.accounting_periods(id),
    pay_date           DATE NOT NULL,
    headcount          SMALLINT,
    gross_salary       acc.money_amt NOT NULL DEFAULT 0,  -- เงินเดือนรวมก่อนหัก
    other_allowance    acc.money_amt NOT NULL DEFAULT 0,
    sso_employee       acc.money_amt NOT NULL DEFAULT 0,  -- ประกันสังคมส่วนลูกจ้าง (หักจากพนักงาน)
    sso_employer       acc.money_amt NOT NULL DEFAULT 0,  -- ส่วนนายจ้าง (ค่าใช้จ่ายบริษัท)
    wht_pnd1           acc.money_amt NOT NULL DEFAULT 0,  -- ภาษีหัก ณ ที่จ่ายพนักงาน
    other_deduction    acc.money_amt NOT NULL DEFAULT 0,
    net_paid           acc.money_amt NOT NULL DEFAULT 0,  -- ยอดโอนเข้าบัญชีพนักงาน
    source_system      TEXT,                              -- ชื่อระบบเงินเดือนต้นทาง
    source_file_url    TEXT,                              -- ไฟล์สรุปที่นำเข้า (หลักฐานอ้างอิง)
    status             acc.doc_status NOT NULL DEFAULT 'DRAFT',
    journal_entry_id   BIGINT REFERENCES acc.journal_entries(id),
    created_by         BIGINT NOT NULL REFERENCES acc.app_users(id),
    UNIQUE (period_id, pay_date),
    -- ยอดสรุปต้องกระทบกันได้ ก่อนอนุญาตให้ post
    CONSTRAINT payroll_reconciles CHECK (
        net_paid = gross_salary + other_allowance - sso_employee - wht_pnd1 - other_deduction)
);

-- ตารางรายคน: ไม่บังคับกรอก ใช้เมื่อต้องการออก ภงด.1 / 50 ทวิ จากในระบบ
CREATE TABLE acc.payroll_batch_lines (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id      BIGINT NOT NULL REFERENCES acc.payroll_batches(id) ON DELETE CASCADE,
    employee_name TEXT NOT NULL,
    employee_tax_id TEXT,
    gross_salary  acc.money_amt NOT NULL DEFAULT 0,
    sso_employee  acc.money_amt NOT NULL DEFAULT 0,
    wht_amount    acc.money_amt NOT NULL DEFAULT 0,
    net_paid      acc.money_amt NOT NULL DEFAULT 0,
    CONSTRAINT pbl_tax_id_format CHECK (employee_tax_id IS NULL OR employee_tax_id ~ '^[0-9]{13}$')
);

-- =====================================================================
-- 10. สินทรัพย์ถาวรและค่าเสื่อมราคา
-- =====================================================================

CREATE TABLE acc.fixed_assets (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_code           TEXT NOT NULL UNIQUE,
    asset_name           TEXT NOT NULL,
    category             TEXT,
    purchase_date        DATE NOT NULL,
    in_service_date      DATE NOT NULL,        -- วันเริ่มคิดค่าเสื่อม (อาจต่างจากวันซื้อ)
    cost                 acc.money_amt NOT NULL,
    salvage_value        acc.money_amt NOT NULL DEFAULT 0,
    useful_life_years    NUMERIC(4,1) NOT NULL,
    depreciation_method  acc.depreciation_method NOT NULL DEFAULT 'STRAIGHT_LINE',
    -- บัญชีที่เกี่ยวข้อง แยกต่อประเภทสินทรัพย์
    asset_account_id     BIGINT NOT NULL REFERENCES acc.chart_of_accounts(id),
    accum_dep_account_id BIGINT NOT NULL REFERENCES acc.chart_of_accounts(id),
    dep_expense_account_id BIGINT NOT NULL REFERENCES acc.chart_of_accounts(id),
    accumulated_depreciation acc.money_amt NOT NULL DEFAULT 0,
    disposal_date        DATE,
    status               TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE / FULLY_DEPRECIATED / DISPOSED
    bill_id              BIGINT REFERENCES acc.ap_bills(id),
    cost_center_id       BIGINT REFERENCES acc.cost_centers(id),
    CONSTRAINT fa_life_positive    CHECK (useful_life_years > 0),
    CONSTRAINT fa_salvage_lte_cost CHECK (salvage_value <= cost),
    CONSTRAINT fa_accum_not_over   CHECK (accumulated_depreciation <= cost - salvage_value),
    CONSTRAINT fa_service_after_purchase CHECK (in_service_date >= purchase_date)
);

-- book_value คำนวณจากคอลัมน์อื่นเสมอ ไม่เก็บซ้ำเพื่อกันข้อมูลขัดแย้งกันเอง
ALTER TABLE acc.fixed_assets
    ADD COLUMN book_value NUMERIC(15,2)
    GENERATED ALWAYS AS (cost - accumulated_depreciation) STORED;

CREATE TABLE acc.depreciation_entries (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fixed_asset_id      BIGINT NOT NULL REFERENCES acc.fixed_assets(id),
    period_id           BIGINT NOT NULL REFERENCES acc.accounting_periods(id),
    depreciation_amount acc.money_amt NOT NULL,
    journal_entry_id    BIGINT REFERENCES acc.journal_entries(id),
    -- กันคิดค่าเสื่อมซ้ำงวดเดียวกัน (เป็นบั๊กที่พบบ่อยที่สุดของโมดูลนี้)
    UNIQUE (fixed_asset_id, period_id)
);

-- =====================================================================
-- 11. ภาษีมูลค่าเพิ่ม — รายงานภาษีซื้อ/ขายตามรูปแบบประกาศอธิบดี
-- =====================================================================
-- เก็บเป็นตาราง (ไม่ใช่ view) เพราะรายงานที่ยื่นสรรพากรไปแล้วต้องไม่เปลี่ยนย้อนหลัง

CREATE TABLE acc.vat_output_items (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    period_id         BIGINT NOT NULL REFERENCES acc.accounting_periods(id),
    seq_no            INT NOT NULL,
    tax_invoice_date  DATE NOT NULL,
    tax_invoice_no    TEXT NOT NULL,
    customer_name     TEXT NOT NULL,
    customer_tax_id   TEXT,
    customer_branch   TEXT,
    base_amount       acc.money_amt NOT NULL,
    vat_amount        acc.money_amt NOT NULL,
    source_type       acc.je_source NOT NULL,
    source_doc_id     BIGINT,
    journal_entry_id  BIGINT REFERENCES acc.journal_entries(id),
    UNIQUE (period_id, seq_no)
);

CREATE TABLE acc.vat_input_items (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    period_id         BIGINT NOT NULL REFERENCES acc.accounting_periods(id),
    seq_no            INT NOT NULL,
    tax_invoice_date  DATE NOT NULL,
    tax_invoice_no    TEXT NOT NULL,
    vendor_name       TEXT NOT NULL,
    vendor_tax_id     TEXT,
    vendor_branch     TEXT,
    base_amount       acc.money_amt NOT NULL,
    vat_amount        acc.money_amt NOT NULL,
    is_claimable      BOOLEAN NOT NULL DEFAULT TRUE,   -- ภาษีซื้อต้องห้ามให้ตั้ง FALSE
    source_type       acc.je_source NOT NULL,
    source_doc_id     BIGINT,
    journal_entry_id  BIGINT REFERENCES acc.journal_entries(id),
    UNIQUE (period_id, seq_no)
);

CREATE TABLE acc.vat_filings (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    period_id      BIGINT NOT NULL UNIQUE REFERENCES acc.accounting_periods(id),
    output_vat     acc.money_amt NOT NULL DEFAULT 0,
    input_vat      acc.money_amt NOT NULL DEFAULT 0,
    net_payable    acc.money_amt NOT NULL DEFAULT 0,   -- บวก = ต้องชำระ, ลบ = ขอคืน/ยกไป
    filed_date     DATE,
    filed_by       BIGINT REFERENCES acc.app_users(id),
    journal_entry_id BIGINT REFERENCES acc.journal_entries(id),
    CONSTRAINT vat_filing_net CHECK (net_payable = output_vat - input_vat)
);

-- =====================================================================
-- 12. ธนาคาร — กระทบยอด (Bank Reconciliation)
-- =====================================================================

CREATE TABLE acc.bank_statement_lines (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bank_account_id BIGINT NOT NULL REFERENCES acc.bank_accounts(id),
    txn_date        DATE NOT NULL,
    value_date      DATE,
    description     TEXT,
    debit_amount    acc.money_amt NOT NULL DEFAULT 0,   -- เงินออกจากบัญชีธนาคาร
    credit_amount   acc.money_amt NOT NULL DEFAULT 0,   -- เงินเข้าบัญชีธนาคาร
    running_balance NUMERIC(15,2),
    external_ref    TEXT,
    matched_line_id BIGINT REFERENCES acc.journal_entry_lines(id),
    matched_at      TIMESTAMPTZ,
    UNIQUE (bank_account_id, txn_date, external_ref),
    CONSTRAINT bsl_one_side CHECK ((debit_amount > 0) <> (credit_amount > 0))
);

CREATE INDEX idx_bsl_unmatched ON acc.bank_statement_lines (bank_account_id, txn_date)
    WHERE matched_line_id IS NULL;

CREATE TABLE acc.bank_reconciliations (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bank_account_id   BIGINT NOT NULL REFERENCES acc.bank_accounts(id),
    period_id         BIGINT NOT NULL REFERENCES acc.accounting_periods(id),
    statement_balance acc.money_amt NOT NULL,
    gl_balance        acc.money_amt NOT NULL,
    difference        acc.money_amt NOT NULL,
    is_balanced       BOOLEAN GENERATED ALWAYS AS (difference = 0) STORED,
    reconciled_by     BIGINT REFERENCES acc.app_users(id),
    reconciled_at     TIMESTAMPTZ,
    UNIQUE (bank_account_id, period_id)
);

-- =====================================================================
-- 13. ปิดงวด และยอดคงเหลือรายงวด
-- =====================================================================

CREATE TABLE acc.closing_entries (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    period_id        BIGINT NOT NULL REFERENCES acc.accounting_periods(id),
    journal_entry_id BIGINT NOT NULL REFERENCES acc.journal_entries(id),
    closing_type     TEXT NOT NULL,   -- REVENUE_CLOSE / EXPENSE_CLOSE / INCOME_SUMMARY / LEGAL_RESERVE
    UNIQUE (period_id, closing_type)
);

-- สแนปช็อตยอดคงเหลือทุกบัญชีตอนปิดงวด
-- ทำให้ออกงบทดลอง/GL ที่มี "ยอดยกมา" ได้เร็ว โดยไม่ต้องสแกน ledger ทั้งก้อนทุกครั้ง
CREATE TABLE acc.account_period_balances (
    period_id        BIGINT NOT NULL REFERENCES acc.accounting_periods(id),
    account_id       BIGINT NOT NULL REFERENCES acc.chart_of_accounts(id),
    opening_debit    acc.money_amt NOT NULL DEFAULT 0,
    opening_credit   acc.money_amt NOT NULL DEFAULT 0,
    period_debit     acc.money_amt NOT NULL DEFAULT 0,
    period_credit    acc.money_amt NOT NULL DEFAULT 0,
    closing_debit    acc.money_amt NOT NULL DEFAULT 0,
    closing_credit   acc.money_amt NOT NULL DEFAULT 0,
    computed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (period_id, account_id)
);

-- =====================================================================
-- 14. Audit Log
-- =====================================================================

CREATE TABLE acc.audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name  TEXT NOT NULL,
    record_id   BIGINT,
    action      TEXT NOT NULL,          -- INSERT / UPDATE / DELETE
    changed_by  TEXT,                   -- current_setting('app.current_user')
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    old_data    JSONB,
    new_data    JSONB
);

CREATE INDEX idx_audit_table  ON acc.audit_log (table_name, record_id);
CREATE INDEX idx_audit_time   ON acc.audit_log (changed_at DESC);

CREATE OR REPLACE FUNCTION acc.fn_audit()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_old JSONB;
    v_new JSONB;
BEGIN
    -- ห้ามเรียก to_jsonb(NEW) ในเหตุการณ์ DELETE หรือ to_jsonb(OLD) ในเหตุการณ์ INSERT
    -- เพราะ record ฝั่งนั้นยังไม่ถูกกำหนดค่า จะเกิด error ทันที
    IF TG_OP IN ('UPDATE','DELETE') THEN v_old := to_jsonb(OLD); END IF;
    IF TG_OP IN ('INSERT','UPDATE') THEN v_new := to_jsonb(NEW); END IF;

    INSERT INTO acc.audit_log (table_name, record_id, action, changed_by, old_data, new_data)
    VALUES (
        TG_TABLE_NAME,
        COALESCE((v_new->>'id')::BIGINT, (v_old->>'id')::BIGINT),
        TG_OP,
        current_setting('app.current_user', TRUE),
        v_old,
        v_new
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

-- ติด audit ให้ตารางที่มีผลต่อตัวเลขทางบัญชี
CREATE TRIGGER trg_audit_je      AFTER INSERT OR UPDATE OR DELETE ON acc.journal_entries
    FOR EACH ROW EXECUTE FUNCTION acc.fn_audit();
CREATE TRIGGER trg_audit_jel     AFTER INSERT OR UPDATE OR DELETE ON acc.journal_entry_lines
    FOR EACH ROW EXECUTE FUNCTION acc.fn_audit();
CREATE TRIGGER trg_audit_coa     AFTER INSERT OR UPDATE OR DELETE ON acc.chart_of_accounts
    FOR EACH ROW EXECUTE FUNCTION acc.fn_audit();
CREATE TRIGGER trg_audit_periods AFTER INSERT OR UPDATE OR DELETE ON acc.accounting_periods
    FOR EACH ROW EXECUTE FUNCTION acc.fn_audit();
CREATE TRIGGER trg_audit_inv     AFTER INSERT OR UPDATE OR DELETE ON acc.ar_invoices
    FOR EACH ROW EXECUTE FUNCTION acc.fn_audit();
CREATE TRIGGER trg_audit_bill    AFTER INSERT OR UPDATE OR DELETE ON acc.ap_bills
    FOR EACH ROW EXECUTE FUNCTION acc.fn_audit();

-- =====================================================================
-- 15. VIEW และฟังก์ชันรายงาน
-- =====================================================================

-- 15.1 รายการเดินบัญชีทั้งหมด (เฉพาะที่ POSTED เท่านั้นที่ถือเป็นตัวเลขจริง)
CREATE OR REPLACE VIEW acc.v_gl_movements AS
SELECT je.id            AS entry_id,
       je.entry_no,
       je.entry_date,
       je.period_id,
       p.period_name,
       je.source_type,
       je.description   AS entry_description,
       l.id             AS line_id,
       l.line_no,
       l.account_id,
       a.account_code,
       a.account_name,
       a.account_type,
       l.debit_amount,
       l.credit_amount,
       l.description    AS line_description,
       l.partner_id,
       l.cost_center_id,
       l.reference_doc
  FROM acc.journal_entries je
  JOIN acc.accounting_periods p    ON p.id = je.period_id
  JOIN acc.journal_entry_lines l   ON l.journal_entry_id = je.id
  JOIN acc.chart_of_accounts a     ON a.id = l.account_id
 WHERE je.status = 'POSTED';

-- 15.2 งบทดลอง ณ งวดใดงวดหนึ่ง (ยอดยกมา + เคลื่อนไหว + ยอดคงเหลือ)
CREATE OR REPLACE FUNCTION acc.fn_trial_balance(p_period_id BIGINT)
RETURNS TABLE (
    account_code   TEXT,
    account_name   TEXT,
    account_type   acc.account_type,
    opening_balance NUMERIC(15,2),
    period_debit   NUMERIC(15,2),
    period_credit  NUMERIC(15,2),
    closing_balance NUMERIC(15,2)
)
LANGUAGE sql STABLE AS $$
    -- ใช้ CROSS JOIN แทนการวาง subquery ไว้ใน FILTER (PostgreSQL ไม่รองรับ subquery ใน FILTER)
    WITH tgt AS (SELECT start_date, end_date FROM acc.accounting_periods WHERE id = p_period_id),
    mv AS (
        SELECT m.account_id,
               SUM(m.debit_amount)  FILTER (WHERE m.entry_date <  t.start_date) AS pre_dr,
               SUM(m.credit_amount) FILTER (WHERE m.entry_date <  t.start_date) AS pre_cr,
               SUM(m.debit_amount)  FILTER (WHERE m.entry_date >= t.start_date) AS cur_dr,
               SUM(m.credit_amount) FILTER (WHERE m.entry_date >= t.start_date) AS cur_cr
          FROM acc.v_gl_movements m
         CROSS JOIN tgt t
         WHERE m.entry_date <= t.end_date
         GROUP BY m.account_id
    )
    SELECT a.account_code,
           a.account_name,
           a.account_type,
           -- แสดงยอดตามด้านปกติของบัญชี: Dr เป็นบวก, Cr เป็นลบ
           COALESCE(mv.pre_dr,0) - COALESCE(mv.pre_cr,0),
           COALESCE(mv.cur_dr,0),
           COALESCE(mv.cur_cr,0),
           COALESCE(mv.pre_dr,0) - COALESCE(mv.pre_cr,0)
             + COALESCE(mv.cur_dr,0) - COALESCE(mv.cur_cr,0)
      FROM acc.chart_of_accounts a
      JOIN mv ON mv.account_id = a.id
     ORDER BY a.account_code;
$$;

-- 15.3 อายุลูกหนี้
CREATE OR REPLACE VIEW acc.v_ar_aging AS
SELECT i.customer_id,
       bp.partner_name,
       i.id AS invoice_id,
       i.doc_no,
       i.issue_date,
       i.due_date,
       i.balance_due,
       (CURRENT_DATE - i.due_date) AS days_overdue,
       CASE
         WHEN CURRENT_DATE <= i.due_date            THEN 'CURRENT'
         WHEN CURRENT_DATE - i.due_date <= 30       THEN '1-30'
         WHEN CURRENT_DATE - i.due_date <= 60       THEN '31-60'
         WHEN CURRENT_DATE - i.due_date <= 90       THEN '61-90'
         ELSE '90+'
       END AS aging_bucket
  FROM acc.ar_invoices i
  JOIN acc.business_partners bp ON bp.id = i.customer_id
 WHERE i.balance_due > 0
   AND i.status NOT IN ('DRAFT','CANCELLED');

-- 15.4 กระทบยอดบัญชีคุมกับบัญชีย่อย  <-- ต้องเป็นศูนย์เสมอ
-- ถ้าไม่เป็นศูนย์แปลว่าระบบเริ่มเพี้ยน ต้องบล็อกการปิดงวดทันที
CREATE OR REPLACE VIEW acc.v_control_reconciliation AS
WITH ar_gl AS (
    SELECT COALESCE(SUM(m.debit_amount - m.credit_amount),0) AS gl_balance
      FROM acc.v_gl_movements m
     WHERE m.account_id = (SELECT account_id FROM acc.account_mappings WHERE key = 'AR_TRADE')
), ar_sub AS (
    SELECT COALESCE(SUM(balance_due),0) AS sub_balance
      FROM acc.ar_invoices WHERE status NOT IN ('DRAFT','CANCELLED')
), ap_gl AS (
    SELECT COALESCE(SUM(m.credit_amount - m.debit_amount),0) AS gl_balance
      FROM acc.v_gl_movements m
     WHERE m.account_id = (SELECT account_id FROM acc.account_mappings WHERE key = 'AP_TRADE')
), ap_sub AS (
    SELECT COALESCE(SUM(balance_due),0) AS sub_balance
      FROM acc.ap_bills WHERE status NOT IN ('DRAFT','CANCELLED')
)
SELECT 'ลูกหนี้การค้า' AS control_account,
       ar_gl.gl_balance, ar_sub.sub_balance,
       ar_gl.gl_balance - ar_sub.sub_balance AS difference
  FROM ar_gl, ar_sub
UNION ALL
SELECT 'เจ้าหนี้การค้า',
       ap_gl.gl_balance, ap_sub.sub_balance,
       ap_gl.gl_balance - ap_sub.sub_balance
  FROM ap_gl, ap_sub;

-- 15.5 ตรวจสมการบัญชี: สินทรัพย์ = หนี้สิน + ส่วนของผู้ถือหุ้น (+ กำไรสะสมงวดปัจจุบัน)
CREATE OR REPLACE VIEW acc.v_accounting_equation_check AS
SELECT
    SUM(CASE WHEN a.account_type = 'ASSET'     THEN l.debit_amount - l.credit_amount ELSE 0 END) AS total_assets,
    SUM(CASE WHEN a.account_type = 'LIABILITY' THEN l.credit_amount - l.debit_amount ELSE 0 END) AS total_liabilities,
    SUM(CASE WHEN a.account_type = 'EQUITY'    THEN l.credit_amount - l.debit_amount ELSE 0 END) AS total_equity,
    SUM(CASE WHEN a.account_type = 'REVENUE'   THEN l.credit_amount - l.debit_amount ELSE 0 END) AS total_revenue,
    SUM(CASE WHEN a.account_type = 'EXPENSE'   THEN l.debit_amount - l.credit_amount ELSE 0 END) AS total_expense,
    SUM(CASE WHEN a.account_type = 'ASSET'     THEN l.debit_amount  - l.credit_amount ELSE 0 END)
  - SUM(CASE WHEN a.account_type = 'LIABILITY' THEN l.credit_amount - l.debit_amount ELSE 0 END)
  - SUM(CASE WHEN a.account_type = 'EQUITY'    THEN l.credit_amount - l.debit_amount ELSE 0 END)
  - SUM(CASE WHEN a.account_type = 'REVENUE'   THEN l.credit_amount - l.debit_amount ELSE 0 END)
  + SUM(CASE WHEN a.account_type = 'EXPENSE'   THEN l.debit_amount  - l.credit_amount ELSE 0 END)
      AS out_of_balance   -- ต้องเป็น 0.00 เสมอ
  FROM acc.journal_entries je
  JOIN acc.journal_entry_lines l ON l.journal_entry_id = je.id
  JOIN acc.chart_of_accounts a   ON a.id = l.account_id
 WHERE je.status = 'POSTED';

-- =====================================================================
-- 16. ฟังก์ชันปิดงวด (ตรวจเงื่อนไขก่อนอนุญาตให้ปิด)
-- =====================================================================

CREATE OR REPLACE FUNCTION acc.close_period(p_period_id BIGINT, p_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    v_draft_count INT;
    v_diff        NUMERIC(15,2);
    v_unbalanced  NUMERIC(15,2);
    v_period      acc.accounting_periods%ROWTYPE;
BEGIN
    SELECT * INTO v_period FROM acc.accounting_periods WHERE id = p_period_id FOR UPDATE;

    IF v_period.status <> 'OPEN' THEN
        RAISE EXCEPTION 'งวด % ไม่ได้อยู่ในสถานะ OPEN', v_period.period_name;
    END IF;

    -- 1) ห้ามมี JE ค้างสถานะ DRAFT
    SELECT COUNT(*) INTO v_draft_count
      FROM acc.journal_entries WHERE period_id = p_period_id AND status = 'DRAFT';
    IF v_draft_count > 0 THEN
        RAISE EXCEPTION 'ยังมีรายการบัญชีค้างร่างอยู่ % รายการ ต้องจัดการก่อนปิดงวด', v_draft_count;
    END IF;

    -- 2) สมการบัญชีต้องสมดุล
    SELECT out_of_balance INTO v_unbalanced FROM acc.v_accounting_equation_check;
    IF v_unbalanced <> 0 THEN
        RAISE EXCEPTION 'สมการบัญชีไม่สมดุล ผลต่าง % บาท', v_unbalanced;
    END IF;

    -- 3) บัญชีคุมต้องตรงกับบัญชีย่อย
    SELECT MAX(ABS(difference)) INTO v_diff FROM acc.v_control_reconciliation;
    IF COALESCE(v_diff,0) <> 0 THEN
        RAISE EXCEPTION 'บัญชีคุมไม่ตรงกับบัญชีย่อย ผลต่างสูงสุด % บาท', v_diff;
    END IF;

    -- 4) บันทึกสแนปช็อตยอดคงเหลือ
    INSERT INTO acc.account_period_balances
        (period_id, account_id, opening_debit, opening_credit,
         period_debit, period_credit, closing_debit, closing_credit)
    SELECT p_period_id, a.id,
           GREATEST(tb.opening_balance,0), GREATEST(-tb.opening_balance,0),
           tb.period_debit, tb.period_credit,
           GREATEST(tb.closing_balance,0), GREATEST(-tb.closing_balance,0)
      FROM acc.fn_trial_balance(p_period_id) tb
      JOIN acc.chart_of_accounts a ON a.account_code = tb.account_code
    ON CONFLICT (period_id, account_id) DO UPDATE
       SET period_debit   = EXCLUDED.period_debit,
           period_credit  = EXCLUDED.period_credit,
           closing_debit  = EXCLUDED.closing_debit,
           closing_credit = EXCLUDED.closing_credit,
           computed_at    = now();

    UPDATE acc.accounting_periods
       SET status = 'CLOSED', closed_by = p_user_id, closed_at = now()
     WHERE id = p_period_id;
END $$;

COMMIT;

-- =====================================================================
--  ผังบัญชีเริ่มต้นสำหรับธุรกิจบริการ (TFRS for NPAEs)
--  แยกไฟล์: db/seed_chart_of_accounts.sql
-- =====================================================================
