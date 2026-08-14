-- =====================================================================
--  ส่งออกข้อมูลให้สำนักงานบัญชี — ตั้งค่าและบันทึกการซิงก์
--  รันได้ซ้ำโดยไม่เสียหาย (idempotent)
-- =====================================================================

BEGIN;
SET search_path TO acc, public;

-- ---------------------------------------------------------------------
-- ปลายทางการส่งออก (ตอนนี้รองรับ Google Sheets)
--
-- คำเตือนด้านความปลอดภัย: ตารางนี้เก็บ private key ของ Service Account
-- ผู้ที่อ่านฐานข้อมูลได้จะเขียน Google Sheet นั้นได้ด้วย
-- จึงควรจำกัดสิทธิ์เข้าถึงฐานข้อมูล และใช้ Service Account
-- ที่มีสิทธิ์เฉพาะไฟล์ที่แชร์ให้เท่านั้น (อย่าให้สิทธิ์ระดับโปรเจกต์)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS acc.export_targets (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                  TEXT NOT NULL DEFAULT 'สำนักงานบัญชี',
    spreadsheet_id        TEXT NOT NULL,
    service_account_email TEXT NOT NULL,
    service_account_json  TEXT NOT NULL,
    -- ขอบเขตข้อมูลที่ส่ง: PERIOD = เฉพาะงวดล่าสุดที่มีรายการ, YEAR = ทั้งปีบัญชี
    scope                 TEXT NOT NULL DEFAULT 'YEAR',
    is_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
    last_sync_at          TIMESTAMPTZ,
    last_sync_ok          BOOLEAN,
    last_sync_message     TEXT,
    created_by            BIGINT REFERENCES acc.app_users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT export_scope_valid CHECK (scope IN ('PERIOD','YEAR'))
);

-- ---------------------------------------------------------------------
-- บันทึกทุกครั้งที่ซิงก์ ใช้ตรวจย้อนหลังว่าส่งอะไรไปเมื่อไหร่
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS acc.export_log (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    target_id    BIGINT REFERENCES acc.export_targets(id) ON DELETE CASCADE,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    succeeded    BOOLEAN,
    rows_written INTEGER,
    tabs         TEXT,
    range_label  TEXT,
    message      TEXT,
    triggered_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_export_log_time ON acc.export_log (started_at DESC);

-- โทเคนสำหรับให้ระบบตั้งเวลาภายนอกเรียกซิงก์ได้
-- gen_random_uuid() มีมาให้ตั้งแต่ PostgreSQL 13 ไม่ต้องติดตั้ง extension เพิ่ม
INSERT INTO acc.system_settings (key, value, description)
VALUES ('EXPORT_CRON_TOKEN',
        replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
        'โทเคนสำหรับเรียก /api/export/sync จากงานตั้งเวลาภายนอก')
ON CONFLICT (key) DO NOTHING;

DROP TRIGGER IF EXISTS trg_audit_export_targets ON acc.export_targets;
CREATE TRIGGER trg_audit_export_targets
    AFTER INSERT OR UPDATE OR DELETE ON acc.export_targets
    FOR EACH ROW EXECUTE FUNCTION acc.fn_audit();

COMMIT;
