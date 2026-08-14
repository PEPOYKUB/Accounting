-- =====================================================================
--  ผู้ใช้งานสำหรับชุดสาธิต (Demo Users)
--  รหัสผ่านทุกบัญชี: Demo@2569
--  ระบบจะบังคับให้เปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก
--  แฮชด้วย scrypt (N=32768, r=8, p=1) เกลือสุ่มแยกรายบัญชี ไม่เก็บรหัสผ่านจริง
--
--  สร้างรหัสผ่านใหม่:  cd web && node scripts/set-password.mjs <username>
-- =====================================================================

BEGIN;
SET search_path TO acc, public;

-- สมชาย ใจดี (AR_AP_CLERK) — ออกเอกสารขาย-ซื้อ บันทึกรับ-จ่ายเงิน
INSERT INTO acc.app_users (username, full_name, email, password_hash, must_change_password)
VALUES ('somchai', 'สมชาย ใจดี', 'somchai@demo.co.th', 'scrypt$32768$8$1$GLJASPIq6VmDFq5ISQ6wWg==$f7o1q1sAUSrt6p8FReBlZd1am+80MODzoT3dLQrzb6s=', TRUE)
ON CONFLICT (username) DO UPDATE SET
  full_name = EXCLUDED.full_name, email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash, must_change_password = TRUE, is_active = TRUE;
INSERT INTO acc.user_roles (user_id, role_code)
SELECT id, 'AR_AP_CLERK' FROM acc.app_users WHERE username = 'somchai'
ON CONFLICT DO NOTHING;

-- มาลี รอบคอบ (CONTROLLER) — ปิดงวด อนุมัติรายการ แก้ผังบัญชี ดูงบการเงิน
INSERT INTO acc.app_users (username, full_name, email, password_hash, must_change_password)
VALUES ('malee', 'มาลี รอบคอบ', 'malee@demo.co.th', 'scrypt$32768$8$1$MJqZXT98MrjIk1hsP1Gtew==$H4IysVXEQ+5xbRuXHXn/ptI/YXJsz2nWNIiv2MEVI9A=', TRUE)
ON CONFLICT (username) DO UPDATE SET
  full_name = EXCLUDED.full_name, email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash, must_change_password = TRUE, is_active = TRUE;
INSERT INTO acc.user_roles (user_id, role_code)
SELECT id, 'CONTROLLER' FROM acc.app_users WHERE username = 'malee'
ON CONFLICT DO NOTHING;

-- วิภา ละเอียด (SENIOR_ACCOUNTANT) — ลงบัญชีมือ ค่าเสื่อมราคา กระทบยอดธนาคาร
INSERT INTO acc.app_users (username, full_name, email, password_hash, must_change_password)
VALUES ('wipha', 'วิภา ละเอียด', 'wipha@demo.co.th', 'scrypt$32768$8$1$2r8BxFYRDzSbSXgW7rSAvA==$ItSI3mQZ6HoYKa9uOq4B8wpctliQGMRBApJn0DChV9w=', TRUE)
ON CONFLICT (username) DO UPDATE SET
  full_name = EXCLUDED.full_name, email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash, must_change_password = TRUE, is_active = TRUE;
INSERT INTO acc.user_roles (user_id, role_code)
SELECT id, 'SENIOR_ACCOUNTANT' FROM acc.app_users WHERE username = 'wipha'
ON CONFLICT DO NOTHING;

-- ธนา ผู้ก่อตั้ง (VIEWER) — ดูรายงานอย่างเดียว
INSERT INTO acc.app_users (username, full_name, email, password_hash, must_change_password)
VALUES ('owner', 'ธนา ผู้ก่อตั้ง', 'owner@demo.co.th', 'scrypt$32768$8$1$nyDSHh99UE1KOBpT7pxyZw==$7pgH8xm0R3csI6YTUMzydMsbQdZp4txl+9mU6TUwpgo=', TRUE)
ON CONFLICT (username) DO UPDATE SET
  full_name = EXCLUDED.full_name, email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash, must_change_password = TRUE, is_active = TRUE;
INSERT INTO acc.user_roles (user_id, role_code)
SELECT id, 'VIEWER' FROM acc.app_users WHERE username = 'owner'
ON CONFLICT DO NOTHING;

-- ผู้สอบบัญชีภายนอก (AUDITOR) — ดูได้ทุกอย่าง รวมถึงบันทึกการแก้ไข
INSERT INTO acc.app_users (username, full_name, email, password_hash, must_change_password)
VALUES ('auditor', 'ผู้สอบบัญชีภายนอก', 'auditor@demo.co.th', 'scrypt$32768$8$1$QVKAuqlsKV3R5xcKmmBlBQ==$jP50bT4JhZ4Xga8+NBIv/Y4XP03TrEjx1d2QHP7LLbc=', TRUE)
ON CONFLICT (username) DO UPDATE SET
  full_name = EXCLUDED.full_name, email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash, must_change_password = TRUE, is_active = TRUE;
INSERT INTO acc.user_roles (user_id, role_code)
SELECT id, 'AUDITOR' FROM acc.app_users WHERE username = 'auditor'
ON CONFLICT DO NOTHING;

COMMIT;