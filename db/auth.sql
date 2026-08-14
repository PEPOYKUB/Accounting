-- =====================================================================
--  ส่วนขยายสำหรับระบบเข้าสู่ระบบ (Authentication & Session)
--  รันได้ซ้ำโดยไม่เสียหาย (idempotent)
-- =====================================================================

BEGIN;
SET search_path TO acc, public;

-- ---------------------------------------------------------------------
-- คอลัมน์เพิ่มเติมของผู้ใช้งาน
-- ---------------------------------------------------------------------
ALTER TABLE acc.app_users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_login_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_attempts      SMALLINT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_changed_at  TIMESTAMPTZ;

-- ---------------------------------------------------------------------
-- เซสชัน — เก็บเฉพาะค่าแฮชของโทเคน ไม่เก็บตัวโทเคนเอง
-- ทำให้ถอนสิทธิ์ (revoke) ได้ และตรวจสอบย้อนหลังได้ว่าใครล็อกอินเมื่อไหร่
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS acc.user_sessions (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES acc.app_users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ,
    user_agent  TEXT,
    ip_address  TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user   ON acc.user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON acc.user_sessions (token_hash)
    WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- บันทึกความพยายามเข้าสู่ระบบ — ใช้ตรวจสอบและกันการเดารหัสผ่าน
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS acc.login_attempts (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username    TEXT NOT NULL,
    succeeded   BOOLEAN NOT NULL,
    reason      TEXT,
    ip_address  TEXT,
    user_agent  TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_time ON acc.login_attempts (attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON acc.login_attempts (username, attempted_at DESC);

-- ---------------------------------------------------------------------
-- ล้างเซสชันหมดอายุ (เรียกเป็นงานประจำ หรือเรียกตอนล็อกอิน)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION acc.purge_expired_sessions()
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE v_n INTEGER;
BEGIN
    DELETE FROM acc.user_sessions
     WHERE expires_at < now() - INTERVAL '7 days'
        OR (revoked_at IS NOT NULL AND revoked_at < now() - INTERVAL '7 days');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END $$;

-- audit log ของการเปลี่ยนแปลงผู้ใช้และสิทธิ์
DROP TRIGGER IF EXISTS trg_audit_users ON acc.app_users;
CREATE TRIGGER trg_audit_users AFTER INSERT OR UPDATE OR DELETE ON acc.app_users
    FOR EACH ROW EXECUTE FUNCTION acc.fn_audit();

DROP TRIGGER IF EXISTS trg_audit_user_roles ON acc.user_roles;
CREATE TRIGGER trg_audit_user_roles AFTER INSERT OR UPDATE OR DELETE ON acc.user_roles
    FOR EACH ROW EXECUTE FUNCTION acc.fn_audit();

COMMIT;
