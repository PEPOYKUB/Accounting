# สถาปัตยกรรมระบบบัญชีเต็มรูปแบบ (Double-Entry Accounting System)
### สำหรับ SME ขนาดเล็ก-กลาง (ทีมบัญชี 2-5 คน)

---

## 1. ภาพรวมระบบ (System Overview)

ระบบบัญชีเต็มรูปแบบต้องยึดหลัก **บัญชีคู่ (Double-Entry Bookkeeping)**: ทุกรายการที่เกิดขึ้นต้องมี **เดบิต = เครดิต** เสมอ และทุกอย่างต้องไหลเข้าสู่ **สมุดรายวันทั่วไป (General Journal)** ก่อนจะสรุปเป็น **บัญชีแยกประเภท (General Ledger)** และออกเป็น **งบการเงิน (Financial Statements)**

### 1.1 แนวคิดสถาปัตยกรรมแบบ Layer (5 ชั้น)

```
[ชั้น 1] เอกสารต้นทาง (Source Documents)
    QT, INV, RC (รายรับ) | PO, PV (รายจ่าย) | Payroll | Fixed Asset

           ↓ แปลงเป็นรายการบัญชีอัตโนมัติ (Auto-Journalizing)

[ชั้น 2] สมุดรายวันย่อย (Sub-Journals)
    สมุดรายวันขาย | สมุดรายวันซื้อ | สมุดเงินสด/ธนาคาร | สมุดรายวันทั่วไป

           ↓ Post

[ชั้น 3] บัญชีแยกประเภททั่วไป (General Ledger - GL)
    ตามผังบัญชี (Chart of Accounts)

           ↓ สรุปยอดคงเหลือ

[ชั้น 4] งบทดลอง (Trial Balance)
    ตรวจสอบเดบิต = เครดิต ทุกบัญชี

           ↓ จัดกลุ่มตามหมวดบัญชี

[ชั้น 5] งบการเงิน (Financial Statements)
    งบกำไรขาดทุน | งบแสดงฐานะการเงิน | งบกระแสเงินสด | งบแสดงการเปลี่ยนแปลงส่วนของผู้ถือหุ้น
```

**หัวใจสำคัญ**: ระบบต้อง "แปลงเอกสาร → รายการบัญชี (Journal Entry)" ให้อัตโนมัติที่สุด เพื่อไม่ให้ฝ่ายบัญชีต้องคีย์ซ้ำสองรอบ (ครั้งแรกตอนออกเอกสาร ครั้งที่สองตอนลงบัญชี)

---

## 2. โมดูลของระบบ (Functional Modules)

| โมดูล | หน้าที่ | เชื่อมกับ GL อย่างไร |
|---|---|---|
| **1. ผังบัญชี (Chart of Accounts)** | กำหนดรหัสบัญชีทั้งหมดของกิจการ | เป็นแกนกลางที่ทุกโมดูลอ้างอิง |
| **2. สมุดรายวันทั่วไป (General Journal / GL)** | บันทึกรายการบัญชีทุกรายการ | เป็นศูนย์กลาง (Core Ledger) |
| **3. ลูกหนี้/รายรับ (AR - Accounts Receivable)** | QT→INV→RC ตามที่ออกแบบไว้เดิม | Auto-post เป็น Dr.ลูกหนี้/เงินสด Cr.รายได้+VAT ขาย |
| **4. เจ้าหนี้/รายจ่าย (AP - Accounts Payable)** | PO→PV Vendor/พนักงาน | Auto-post เป็น Dr.ค่าใช้จ่าย/สินทรัพย์ Cr.เจ้าหนี้/เงินสด |
| **5. เงินสด/ธนาคาร (Cash & Bank)** | กระทบยอดเงินฝากธนาคาร (Bank Reconciliation) | เชื่อมกับทุกรายการที่มีการรับ-จ่ายเงินจริง |
| **6. สินทรัพย์ถาวร (Fixed Assets)** | ทะเบียนทรัพย์สิน + คำนวณค่าเสื่อมราคา | Auto-post ค่าเสื่อมราคาทุกสิ้นเดือน |
| **7. ภาษี (Tax)** | VAT ขาย/ซื้อ, ภงด.3/53/1, 50 ทวิ, ภพ.30 | ดึงจากรายการ AR/AP ที่เกี่ยวข้องกับภาษี |
| **8. ปิดบัญชี (Period-End Closing)** | ปิดงวด, ปรับปรุงรายการ (Adjusting Entries), ยกยอด | ปิดบัญชีรายได้-ค่าใช้จ่ายเข้ากำไรสะสม |
| **9. งบการเงิน (Financial Reports)** | งบกำไรขาดทุน, งบแสดงฐานะการเงิน, งบกระแสเงินสด | ดึงยอดจาก GL ตามหมวดบัญชี |

---

## 3. สถาปัตยกรรมระบบ (Technical Architecture)

```
┌──────────────────────────────────────────────────────────────┐
│                      PRESENTATION LAYER                       │
│  Web App (React/Next.js) — แยกเมนูตามบทบาท                     │
│  - หน้ากรอกเอกสาร (QT/INV/PO/PV)                                │
│  - หน้าลงบัญชี (Journal Entry Editor)                           │
│  - หน้ารายงาน (GL, Trial Balance, งบการเงิน)                    │
└───────────────────────────┬────────────────────────────────────┘
                             │ REST/GraphQL API
┌───────────────────────────▼────────────────────────────────────┐
│                       APPLICATION LAYER                        │
│  Backend (Node.js/NestJS หรือ Django/FastAPI)                  │
│  ┌────────────────┐ ┌─────────────────┐ ┌────────────────────┐│
│  │ Document Service │ │ Journal Engine   │ │ Reporting Service ││
│  │ (QT/INV/PO/PV)   │ │ (Auto-posting +  │ │ (Trial Balance,    ││
│  │                  │ │  Validation Dr=Cr)│ │  P&L, BS, CF)      ││
│  └────────────────┘ └─────────────────┘ └────────────────────┘│
│  ┌────────────────┐ ┌─────────────────┐ ┌────────────────────┐│
│  │ Tax Engine       │ │ Period Closing   │ │ User/Role Manager  ││
│  │ (VAT/WHT calc)   │ │ Engine           │ │ + Audit Log        ││
│  └────────────────┘ └─────────────────┘ └────────────────────┘│
└───────────────────────────┬────────────────────────────────────┘
                             │
┌───────────────────────────▼────────────────────────────────────┐
│                          DATA LAYER                             │
│  PostgreSQL (Relational + ACID สำคัญมากสำหรับบัญชี)              │
│  - Master: chart_of_accounts, customers, vendors, employees     │
│  - Transactional: journal_entries, journal_entry_lines          │
│  - Sub-ledger: ar_invoices, ap_bills, fixed_assets               │
│  - File Storage: เอกสารแนบ (S3/Google Drive)                    │
└──────────────────────────────────────────────────────────────┘
```

### ทำไมต้องมี "Journal Engine" แยกส่วน
นี่คือหัวใจของระบบบัญชีที่ต่างจากระบบ Template ธรรมดา — ทุกเอกสาร (INV, PV, ฯลฯ) เมื่อถูก "อนุมัติ" จะไม่ได้บันทึกลงตารางของตัวเองเฉยๆ แต่ต้อง **สร้างรายการบัญชี (Journal Entry) อัตโนมัติ** ตาม "กฎการลงบัญชี" (Posting Rule) ที่กำหนดไว้ล่วงหน้า และระบบต้อง**บังคับ**ว่า `SUM(debit) = SUM(credit)` ทุกครั้งก่อนบันทึกจริง (มิฉะนั้นปฏิเสธการบันทึก)

---

## 4. โครงสร้างฐานข้อมูล (Database Schema)

### 4.1 ผังบัญชี (Chart of Accounts) — แกนกลางของระบบ
```sql
chart_of_accounts (
  id, account_code,        -- เช่น 1000, 1100, 4000
  account_name,            -- เช่น "เงินสด", "ลูกหนี้การค้า"
  account_type,            -- ENUM: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
  account_subtype,         -- เช่น CURRENT_ASSET, FIXED_ASSET, COGS
  normal_balance,          -- ENUM: DEBIT, CREDIT
  parent_account_id,       -- สำหรับบัญชีแบบลำดับชั้น (Hierarchical)
  is_active, created_at
)
```

ตัวอย่างผังบัญชีเริ่มต้น (ตามมาตรฐานไทยทั่วไป):
| รหัส | ชื่อบัญชี | ประเภท | Normal Balance |
|---|---|---|---|
| 1000-1099 | เงินสดและรายการเทียบเท่าเงินสด | สินทรัพย์ | Dr |
| 1100-1199 | ลูกหนี้การค้า | สินทรัพย์ | Dr |
| 1150 | ภาษีซื้อ (Input VAT) | สินทรัพย์ | Dr |
| 1500-1599 | สินทรัพย์ถาวร | สินทรัพย์ | Dr |
| 2000-2099 | เจ้าหนี้การค้า | หนี้สิน | Cr |
| 2100 | ภาษีขาย (Output VAT) | หนี้สิน | Cr |
| 2200 | ภาษีหัก ณ ที่จ่ายค้างนำส่ง | หนี้สิน | Cr |
| 3000 | ทุน/กำไรสะสม | ส่วนของผู้ถือหุ้น | Cr |
| 4000-4099 | รายได้จากการขาย | รายได้ | Cr |
| 5000-5099 | ต้นทุนขาย | ค่าใช้จ่าย | Dr |
| 5100-5999 | ค่าใช้จ่ายในการดำเนินงาน | ค่าใช้จ่าย | Dr |

### 4.2 สมุดรายวันทั่วไป (Core Journal Tables)
```sql
journal_entries (
  id, entry_no, entry_date, period_id (FK),
  source_type,       -- ENUM: SALES, PURCHASE, PAYMENT, ADJUSTMENT, CLOSING, MANUAL
  source_doc_id,     -- อ้างอิงเอกสารต้นทาง เช่น invoice_id, bill_id
  description,
  status,            -- DRAFT, POSTED, VOID
  created_by, approved_by, posted_at
)

journal_entry_lines (
  id, journal_entry_id (FK),
  account_id (FK -> chart_of_accounts),
  debit_amount, credit_amount,
  description,
  cost_center_id,    -- (ถ้ามีหลายแผนก/สาขา)
  reference_doc      -- เลขที่เอกสารอ้างอิง
)
-- Constraint สำคัญ: SUM(debit_amount) = SUM(credit_amount) ต่อ 1 journal_entry_id
```

### 4.3 บัญชีย่อยลูกหนี้ (AR Sub-ledger)
```sql
ar_invoices (
  id, doc_no, customer_id, quotation_id (nullable),
  issue_date, due_date, items JSON,
  subtotal, vat_amount, total_amount,
  paid_amount, balance_due,
  status,             -- DRAFT, POSTED, PARTIAL_PAID, PAID, OVERDUE, VOID
  journal_entry_id (FK)  -- รายการบัญชีที่ auto-post ตอนออก INV
)

ar_receipts (
  id, doc_no, invoice_id (FK), customer_id,
  receipt_date, amount, payment_method,
  tax_invoice_no,
  journal_entry_id (FK)  -- รายการบัญชีตอนรับเงิน
)
```

### 4.4 บัญชีย่อยเจ้าหนี้ (AP Sub-ledger)
```sql
ap_bills (
  id, doc_no, vendor_id, po_id (nullable),
  bill_date, due_date, items JSON,
  subtotal, vat_amount, wht_amount, total_amount,
  paid_amount, balance_due, status,
  journal_entry_id (FK)
)

ap_payments (
  id, doc_no, bill_id (FK), vendor_id,
  payment_date, amount, payment_method,
  wht_certificate_id (FK -> wht_certificates),
  journal_entry_id (FK)
)
```

### 4.5 สินทรัพย์ถาวรและค่าเสื่อมราคา
```sql
fixed_assets (
  id, asset_code, asset_name, purchase_date,
  cost, salvage_value, useful_life_years,
  depreciation_method,   -- STRAIGHT_LINE, DECLINING_BALANCE
  accumulated_depreciation, book_value, status
)

depreciation_entries (
  id, fixed_asset_id (FK), period_id,
  depreciation_amount, journal_entry_id (FK)
)
```

### 4.6 งวดบัญชีและการปิดบัญชี
```sql
accounting_periods (
  id, period_name,       -- เช่น "2569-08"
  start_date, end_date,
  status,                -- OPEN, CLOSED, LOCKED
  closed_by, closed_at
)

closing_entries (
  id, period_id (FK), journal_entry_id (FK),
  type    -- ENUM: REVENUE_CLOSE, EXPENSE_CLOSE, RETAINED_EARNINGS
)
```

### 4.7 ตารางภาษี (เชื่อมกับ Journal เดิม)
```sql
vat_output_summary (period_id, invoice_id, tax_invoice_no, base_amount, vat_amount)
vat_input_summary  (period_id, bill_id, tax_invoice_no, base_amount, vat_amount)
wht_certificates (
  id, doc_no, payee_id, payee_type, period_id,
  wht_type,        -- เช่น "ภงด.3", "ภงด.53"
  base_amount, wht_rate, wht_amount, pdf_url
)
```

---

## 5. Business Logic หลัก: Posting Rules (กฎการลงบัญชีอัตโนมัติ)

นี่คือส่วนสำคัญที่สุดของระบบบัญชีเต็มรูปแบบ — ทุกเอกสารต้องมี "แม่แบบการลงบัญชี" (Posting Template) กำหนดไว้ล่วงหน้า

### 5.1 ตัวอย่าง Posting Rule: ออกใบแจ้งหนี้ (INV) ขายสินค้า/บริการ
```
Dr. ลูกหนี้การค้า            xxx (subtotal + vat)
    Cr. รายได้จากการขาย           xxx (subtotal)
    Cr. ภาษีขาย (Output VAT)      xxx (vat_amount)
```

### 5.2 ตัวอย่าง Posting Rule: รับชำระเงินจากลูกค้า (RC)
```
Dr. เงินสด/ธนาคาร             xxx
    Cr. ลูกหนี้การค้า                xxx
```

### 5.3 ตัวอย่าง Posting Rule: บันทึกใบสำคัญจ่าย Vendor (มีหัก ณ ที่จ่าย)
```
Dr. ค่าใช้จ่าย/สินทรัพย์         xxx (subtotal)
Dr. ภาษีซื้อ (Input VAT)        xxx (vat_amount)
    Cr. เจ้าหนี้การค้า                 xxx (net ก่อนหัก)
    Cr. ภาษีหัก ณ ที่จ่ายค้างนำส่ง       xxx (wht_amount)
```

### 5.4 ตัวอย่าง Posting Rule: ค่าเสื่อมราคาประจำเดือน (Auto-run ทุกสิ้นเดือน)
```
Dr. ค่าเสื่อมราคา                xxx
    Cr. ค่าเสื่อมราคาสะสม               xxx
```

### 5.5 ตัวอย่าง Posting Rule: ปิดบัญชีสิ้นงวด (Closing Entry)
```
ขั้นที่ 1: ปิดบัญชีรายได้ทั้งหมดเข้า "กำไรขาดทุนรอปิดบัญชี"
Dr. รายได้ทุกบัญชี              xxx
    Cr. กำไรขาดทุนรอปิดบัญชี            xxx

ขั้นที่ 2: ปิดบัญชีค่าใช้จ่ายทั้งหมด
Dr. กำไรขาดทุนรอปิดบัญชี         xxx
    Cr. ค่าใช้จ่ายทุกบัญชี              xxx

ขั้นที่ 3: โอนกำไร/ขาดทุนสุทธิเข้ากำไรสะสม
Dr./Cr. กำไรขาดทุนรอปิดบัญชี      xxx
    Cr./Dr. กำไรสะสม                  xxx
```

### 5.6 กฎการตรวจสอบ (Validation Rules) — ต้อง Enforce ในระบบ
1. `SUM(debit) = SUM(credit)` ทุก Journal Entry (ปฏิเสธถ้าไม่เท่ากัน)
2. ห้ามลงบัญชีย้อนหลังในงวดที่ `status = CLOSED/LOCKED`
3. ทุกบัญชีที่ใช้ใน journal_entry_lines ต้องเป็น `is_active = true`
4. เอกสารต้นทาง (INV/Bill) ต้องผ่านการอนุมัติก่อนจึงจะ Auto-post ได้
5. ห้ามแก้ไข Journal Entry ที่ `status = POSTED` โดยตรง — ต้องสร้างรายการปรับปรุง (Reversing Entry) แทน เพื่อรักษา Audit Trail

---

## 6. รายงานที่ระบบต้องสร้างได้ (Reporting Layer)

| รายงาน | สูตร/แหล่งข้อมูล |
|---|---|
| **งบทดลอง (Trial Balance)** | SUM(debit), SUM(credit) แยกตามบัญชีทุกบัญชี ณ สิ้นงวด |
| **งบกำไรขาดทุน (Income Statement)** | รายได้ (หมวด 4) − ค่าใช้จ่าย (หมวด 5) |
| **งบแสดงฐานะการเงิน (Balance Sheet)** | สินทรัพย์ (หมวด 1) = หนี้สิน (หมวด 2) + ส่วนของผู้ถือหุ้น (หมวด 3) |
| **งบกระแสเงินสด (Cash Flow Statement)** | วิเคราะห์จากการเปลี่ยนแปลงบัญชีเงินสด แยก 3 กิจกรรม (ดำเนินงาน/ลงทุน/จัดหาเงิน) |
| **รายงาน AR/AP Aging** | อายุลูกหนี้/เจ้าหนี้ (0-30, 31-60, 61-90, 90+ วัน) |
| **รายงานภาษี** | ภพ.30 (VAT), ภงด.1/3/53, 50 ทวิ |
| **General Ledger รายบัญชี** | รายการเดินบัญชีทีละบัญชี พร้อมยอดยกมา-ยอดคงเหลือ |

---

## 7. Roles & Permissions (สำหรับทีมบัญชี 2-5 คน)

| บทบาท | สิทธิ์ |
|---|---|
| **ผู้จัดการบัญชี (Controller)** | ปิดงวด, แก้ไขผังบัญชี, อนุมัติ Journal Entry ทุกประเภท, ดูงบการเงิน |
| **นักบัญชีอาวุโส** | สร้าง/แก้ไข Journal Entry, บันทึกค่าเสื่อมราคา, กระทบยอดธนาคาร |
| **นักบัญชี AR/AP** | ออก INV/Bill, บันทึกรับ-จ่ายเงิน (ไม่สามารถแก้ผังบัญชีหรือปิดงวดได้ |
| **เจ้าของ/ผู้บริหาร** | ดูรายงาน/Dashboard เท่านั้น (Read-only) |
| **Auditor (ถ้ามี)** | Read-only ทุกอย่าง + ดู Audit Log |

---

## 8. เทคโนโลยีที่แนะนำ (Tech Stack)

| ส่วนประกอบ | แนะนำ | เหตุผล |
|---|---|---|
| Database | **PostgreSQL** | รองรับ Transaction/ACID เข้มงวด จำเป็นมากสำหรับบัญชี (ห้ามข้อมูลเพี้ยน) |
| Backend | Node.js (NestJS) หรือ Django | NestJS เหมาะกับ Domain-driven design แบบ Journal Engine/Posting Rule ที่ซับซ้อน |
| ORM | Prisma / TypeORM (Node) หรือ Django ORM | ต้องรองรับ Transaction แบบ Atomic (all-or-nothing) เวลา Post journal |
| Frontend | React + Next.js | หน้า UI สำหรับกรอกฟอร์มและดูรายงานจำนวนมาก |
| PDF/Report Export | Puppeteer หรือ ExcelJS | ออกงบการเงิน, 50 ทวิ, รายงานภาษีเป็น PDF/Excel |
| Auth | JWT + Role-based Access Control (RBAC) | จำเป็นเพราะมีหลาย Role ตามข้อ 7 |
| Audit Logging | Event Sourcing หรือ Trigger-based Audit Table | บัญชีต้อง Trace ได้ว่าใครแก้อะไร เมื่อไหร่ |
| Hosting | Render/Railway + Supabase/Neon (PostgreSQL) | เหมาะกับ SME งบไม่สูงแต่ต้องการ Production-grade DB |

> **ข้อควรระวัง**: อย่าใช้ Google Sheets เป็น Database หลักสำหรับระบบนี้ เพราะไม่รองรับ Transaction แบบ Atomic และเสี่ยงข้อมูลเดบิต-เครดิตไม่ตรงกันได้ง่าย เหมาะกับใช้แค่ MVP/Demo เท่านั้น

---

## 9. แผนพัฒนาแบบขั้นตอน (Development Roadmap)

| Phase | สิ่งที่ต้องทำ | Output |
|---|---|---|
| **Phase 1: รากฐาน** | ออกแบบผังบัญชี, ตาราง journal_entries/journal_entry_lines, กฎ Dr=Cr | สามารถลงบัญชีมือ (Manual Journal) ได้ |
| **Phase 2: AR/AP** | สร้างฟอร์ม QT/INV/RC และ PO/Bill/Payment พร้อม Posting Rule อัตโนมัติ | เอกสารขาย-ซื้อ Auto-post เข้า GL |
| **Phase 3: ภาษี** | สร้าง Tax Engine คำนวณ VAT/WHT อัตโนมัติจากรายการ AR/AP | ออกรายงาน ภพ.30, 50 ทวิ ได้ |
| **Phase 4: สินทรัพย์ + ปิดบัญชี** | Fixed Asset Register, ค่าเสื่อมราคาอัตโนมัติ, Closing Engine | ปิดงวดและยกยอดบัญชีได้ |
| **Phase 5: งบการเงิน** | สร้าง Engine ดึงยอดจาก GL ออกเป็นงบทดลอง/งบกำไรขาดทุน/งบแสดงฐานะการเงิน | ออกงบการเงินอัตโนมัติทุกสิ้นเดือน |
| **Phase 6: เสริมความแข็งแรง** | Role-based Access, Audit Log, Bank Reconciliation, Dashboard | พร้อมใช้งานจริงระดับ SME |

---

## 10. ความแตกต่างจากระบบ "รวม Template บัญชี" (เดิม)

| หัวข้อ | ระบบ Template เดิม | ระบบบัญชีเต็มรูปแบบ (ใหม่) |
|---|---|---|
| หลักการ | บันทึกรายรับ-รายจ่ายแยกตาราง แล้วสรุปภาษี | ทุกอย่างต้องผ่านสมุดรายวัน (Journal) แบบ Dr=Cr เสมอ |
| งบการเงิน | ไม่มี (มีแค่สรุปภาษี) | มีงบกำไรขาดทุน, งบแสดงฐานะการเงิน, งบกระแสเงินสด |
| ผังบัญชี | ไม่มี | เป็นแกนกลางของระบบทั้งหมด |
| ความถูกต้อง | พึ่งพาสูตร Excel/Sheet | บังคับด้วย Database Constraint (Dr=Cr) |
| การปิดงวด | ไม่มีแนวคิดนี้ | มี Closing Entry + Lock ป้องกันแก้ย้อนหลัง |
| เหมาะกับ | ธุรกิจเล็กมาก ต้องการแค่สรุปภาษี | SME ที่ต้องยื่นงบการเงินกับกรมพัฒนาธุรกิจการค้า/สรรพากร |

---

## หมายเหตุ
เอกสารนี้ออกแบบสำหรับระบบบัญชีคู่ (Double-Entry) มาตรฐาน เหมาะกับธุรกิจ SME ที่มีทีมบัญชี 2-5 คน และต้องการออกงบการเงินที่ถูกต้องตามหลักบัญชี สามารถขยายเพิ่มโมดูล เช่น สินค้าคงคลัง (Inventory) แบบ Perpetual, ระบบงบประมาณ (Budgeting), หรือ Multi-currency ได้ในอนาคตตามความจำเป็นของธุรกิจ
