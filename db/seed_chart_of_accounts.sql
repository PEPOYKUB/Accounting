-- =====================================================================
--  ผังบัญชีเริ่มต้น + การแมปบทบาททางบัญชี
--  ธุรกิจบริการ | TFRS for NPAEs
--  รันหลัง schema.sql
-- =====================================================================

BEGIN;
SET search_path TO acc, public;

-- ---------------------------------------------------------------------
-- 1. ผังบัญชี
--    allow_posting = FALSE  -> บัญชีหัวข้อ ใช้จัดกลุ่มเท่านั้น ห้ามลงรายการ
--    is_contra     = TRUE   -> บัญชีปรับมูลค่า (ด้านตรงข้ามกับกลุ่มของตัวเอง)
--    cashflow_category      -> ใช้จัดกลุ่มงบกระแสเงินสดวิธีทางอ้อม
-- ---------------------------------------------------------------------

INSERT INTO acc.chart_of_accounts
 (account_code, account_name, account_name_en, account_type, account_subtype,
  normal_balance, allow_posting, is_contra, cashflow_category, npae_report_line)
VALUES
-- ===== 1xxx สินทรัพย์ =====
('1000','สินทรัพย์หมุนเวียน','Current Assets','ASSET','CURRENT_ASSET','DEBIT',FALSE,FALSE,'NONE',NULL),
('1010','เงินสดในมือ','Cash on Hand','ASSET','CASH','DEBIT',TRUE,FALSE,'CASH','เงินสดและรายการเทียบเท่าเงินสด'),
('1020','เงินฝากธนาคาร - กระแสรายวัน','Bank - Current','ASSET','CASH','DEBIT',TRUE,FALSE,'CASH','เงินสดและรายการเทียบเท่าเงินสด'),
('1030','เงินฝากธนาคาร - ออมทรัพย์','Bank - Savings','ASSET','CASH','DEBIT',TRUE,FALSE,'CASH','เงินสดและรายการเทียบเท่าเงินสด'),
('1040','เงินสดย่อย','Petty Cash','ASSET','CASH','DEBIT',TRUE,FALSE,'CASH','เงินสดและรายการเทียบเท่าเงินสด'),

('1100','ลูกหนี้การค้า','Accounts Receivable - Trade','ASSET','CURRENT_ASSET','DEBIT',TRUE,FALSE,'OPERATING','ลูกหนี้การค้าและลูกหนี้อื่น'),
('1110','ค่าเผื่อผลขาดทุนด้านเครดิต','Allowance for Expected Credit Loss','ASSET','CURRENT_ASSET','CREDIT',TRUE,TRUE,'OPERATING','ลูกหนี้การค้าและลูกหนี้อื่น'),
('1120','รายได้ค้างรับ','Accrued Revenue','ASSET','CURRENT_ASSET','DEBIT',TRUE,FALSE,'OPERATING','ลูกหนี้การค้าและลูกหนี้อื่น'),
('1130','ลูกหนี้อื่น','Other Receivables','ASSET','CURRENT_ASSET','DEBIT',TRUE,FALSE,'OPERATING','ลูกหนี้การค้าและลูกหนี้อื่น'),
('1135','เงินทดรองจ่ายพนักงาน','Employee Advances','ASSET','CURRENT_ASSET','DEBIT',TRUE,FALSE,'OPERATING','สินทรัพย์หมุนเวียนอื่น'),
('1140','ค่าใช้จ่ายจ่ายล่วงหน้า','Prepaid Expenses','ASSET','CURRENT_ASSET','DEBIT',TRUE,FALSE,'OPERATING','สินทรัพย์หมุนเวียนอื่น'),
('1145','เงินมัดจำจ่าย','Deposits Paid','ASSET','CURRENT_ASSET','DEBIT',TRUE,FALSE,'OPERATING','สินทรัพย์หมุนเวียนอื่น'),

('1150','ภาษีซื้อ','Input VAT','ASSET','TAX_ASSET','DEBIT',TRUE,FALSE,'OPERATING','สินทรัพย์หมุนเวียนอื่น'),
('1151','พักภาษีซื้อ','Deferred Input VAT','ASSET','TAX_ASSET','DEBIT',TRUE,FALSE,'OPERATING','สินทรัพย์หมุนเวียนอื่น'),
('1155','ภาษีซื้อรอขอคืน','VAT Refundable','ASSET','TAX_ASSET','DEBIT',TRUE,FALSE,'OPERATING','สินทรัพย์หมุนเวียนอื่น'),
('1160','ภาษีเงินได้ถูกหัก ณ ที่จ่าย','Withholding Tax Receivable','ASSET','TAX_ASSET','DEBIT',TRUE,FALSE,'OPERATING','สินทรัพย์หมุนเวียนอื่น'),

('1500','ที่ดิน อาคารและอุปกรณ์','Property, Plant and Equipment','ASSET','NON_CURRENT_ASSET','DEBIT',FALSE,FALSE,'NONE',NULL),
('1510','เครื่องใช้สำนักงาน','Office Equipment','ASSET','FIXED_ASSET','DEBIT',TRUE,FALSE,'INVESTING','ที่ดิน อาคารและอุปกรณ์'),
('1511','ค่าเสื่อมราคาสะสม - เครื่องใช้สำนักงาน','Accum. Dep. - Office Equipment','ASSET','FIXED_ASSET','CREDIT',TRUE,TRUE,'NONE','ที่ดิน อาคารและอุปกรณ์'),
('1520','คอมพิวเตอร์และอุปกรณ์','Computer Equipment','ASSET','FIXED_ASSET','DEBIT',TRUE,FALSE,'INVESTING','ที่ดิน อาคารและอุปกรณ์'),
('1521','ค่าเสื่อมราคาสะสม - คอมพิวเตอร์','Accum. Dep. - Computer','ASSET','FIXED_ASSET','CREDIT',TRUE,TRUE,'NONE','ที่ดิน อาคารและอุปกรณ์'),
('1530','เครื่องตกแต่งและติดตั้ง','Furniture and Fixtures','ASSET','FIXED_ASSET','DEBIT',TRUE,FALSE,'INVESTING','ที่ดิน อาคารและอุปกรณ์'),
('1531','ค่าเสื่อมราคาสะสม - เครื่องตกแต่ง','Accum. Dep. - Furniture','ASSET','FIXED_ASSET','CREDIT',TRUE,TRUE,'NONE','ที่ดิน อาคารและอุปกรณ์'),
('1540','ยานพาหนะ','Vehicles','ASSET','FIXED_ASSET','DEBIT',TRUE,FALSE,'INVESTING','ที่ดิน อาคารและอุปกรณ์'),
('1541','ค่าเสื่อมราคาสะสม - ยานพาหนะ','Accum. Dep. - Vehicles','ASSET','FIXED_ASSET','CREDIT',TRUE,TRUE,'NONE','ที่ดิน อาคารและอุปกรณ์'),
('1600','สินทรัพย์ไม่มีตัวตน - ซอฟต์แวร์','Intangible - Software','ASSET','INTANGIBLE','DEBIT',TRUE,FALSE,'INVESTING','สินทรัพย์ไม่มีตัวตน'),
('1601','ค่าตัดจำหน่ายสะสม - ซอฟต์แวร์','Accum. Amortization - Software','ASSET','INTANGIBLE','CREDIT',TRUE,TRUE,'NONE','สินทรัพย์ไม่มีตัวตน'),

-- ===== 2xxx หนี้สิน =====
('2000','เจ้าหนี้การค้า','Accounts Payable - Trade','LIABILITY','CURRENT_LIABILITY','CREDIT',TRUE,FALSE,'OPERATING','เจ้าหนี้การค้าและเจ้าหนี้อื่น'),
('2010','ค่าใช้จ่ายค้างจ่าย','Accrued Expenses','LIABILITY','CURRENT_LIABILITY','CREDIT',TRUE,FALSE,'OPERATING','เจ้าหนี้การค้าและเจ้าหนี้อื่น'),
('2015','เจ้าหนี้อื่น','Other Payables','LIABILITY','CURRENT_LIABILITY','CREDIT',TRUE,FALSE,'OPERATING','เจ้าหนี้การค้าและเจ้าหนี้อื่น'),
('2020','เงินรับล่วงหน้าจากลูกค้า','Advance Received from Customers','LIABILITY','CURRENT_LIABILITY','CREDIT',TRUE,FALSE,'OPERATING','หนี้สินหมุนเวียนอื่น'),

('2100','ภาษีขาย','Output VAT','LIABILITY','TAX_LIABILITY','CREDIT',TRUE,FALSE,'OPERATING','หนี้สินหมุนเวียนอื่น'),
('2101','พักภาษีขาย','Deferred Output VAT','LIABILITY','TAX_LIABILITY','CREDIT',TRUE,FALSE,'OPERATING','หนี้สินหมุนเวียนอื่น'),
('2110','ภาษีมูลค่าเพิ่มค้างชำระ','VAT Payable','LIABILITY','TAX_LIABILITY','CREDIT',TRUE,FALSE,'OPERATING','หนี้สินหมุนเวียนอื่น'),
('2200','ภาษีหัก ณ ที่จ่ายค้างนำส่ง - ภงด.1','WHT Payable - PND1','LIABILITY','TAX_LIABILITY','CREDIT',TRUE,FALSE,'OPERATING','หนี้สินหมุนเวียนอื่น'),
('2201','ภาษีหัก ณ ที่จ่ายค้างนำส่ง - ภงด.3','WHT Payable - PND3','LIABILITY','TAX_LIABILITY','CREDIT',TRUE,FALSE,'OPERATING','หนี้สินหมุนเวียนอื่น'),
('2202','ภาษีหัก ณ ที่จ่ายค้างนำส่ง - ภงด.53','WHT Payable - PND53','LIABILITY','TAX_LIABILITY','CREDIT',TRUE,FALSE,'OPERATING','หนี้สินหมุนเวียนอื่น'),
('2210','เงินประกันสังคมค้างนำส่ง','Social Security Payable','LIABILITY','CURRENT_LIABILITY','CREDIT',TRUE,FALSE,'OPERATING','หนี้สินหมุนเวียนอื่น'),
('2300','ภาษีเงินได้นิติบุคคลค้างจ่าย','Corporate Income Tax Payable','LIABILITY','TAX_LIABILITY','CREDIT',TRUE,FALSE,'OPERATING','ภาษีเงินได้ค้างจ่าย'),
('2400','เงินกู้ยืมระยะสั้น','Short-term Loans','LIABILITY','CURRENT_LIABILITY','CREDIT',TRUE,FALSE,'FINANCING','เงินกู้ยืมระยะสั้น'),
('2500','เงินกู้ยืมระยะยาว','Long-term Loans','LIABILITY','NON_CURRENT_LIABILITY','CREDIT',TRUE,FALSE,'FINANCING','เงินกู้ยืมระยะยาว'),
('2510','เงินกู้ยืมจากกรรมการ','Loans from Directors','LIABILITY','NON_CURRENT_LIABILITY','CREDIT',TRUE,FALSE,'FINANCING','เงินกู้ยืมระยะยาว'),

-- ===== 3xxx ส่วนของผู้ถือหุ้น =====
('3000','ทุนจดทะเบียนที่ออกและชำระแล้ว','Issued and Paid-up Capital','EQUITY','EQUITY','CREDIT',TRUE,FALSE,'FINANCING','ทุนที่ออกและชำระแล้ว'),
('3100','กำไรสะสม - ยังไม่ได้จัดสรร','Retained Earnings - Unappropriated','EQUITY','EQUITY','CREDIT',TRUE,FALSE,'NONE','กำไรสะสม'),
('3110','สำรองตามกฎหมาย','Legal Reserve','EQUITY','EQUITY','CREDIT',TRUE,FALSE,'NONE','จัดสรรแล้ว - สำรองตามกฎหมาย'),
('3200','สรุปผลกำไรขาดทุน','Income Summary','EQUITY','CLEARING','CREDIT',TRUE,FALSE,'NONE',NULL),
('3300','เงินปันผลจ่าย','Dividends Paid','EQUITY','EQUITY','DEBIT',TRUE,TRUE,'FINANCING','กำไรสะสม'),

-- ===== 4xxx รายได้ =====
('4000','รายได้จากการให้บริการ','Service Revenue','REVENUE','OPERATING_REVENUE','CREDIT',TRUE,FALSE,'OPERATING','รายได้จากการให้บริการ'),
('4010','รายได้ค่าที่ปรึกษา','Consulting Revenue','REVENUE','OPERATING_REVENUE','CREDIT',TRUE,FALSE,'OPERATING','รายได้จากการให้บริการ'),
('4020','รายได้ค่าบริการรายเดือน','Recurring Service Revenue','REVENUE','OPERATING_REVENUE','CREDIT',TRUE,FALSE,'OPERATING','รายได้จากการให้บริการ'),
('4090','ส่วนลดจ่ายและรับคืน','Sales Discounts and Returns','REVENUE','CONTRA_REVENUE','DEBIT',TRUE,TRUE,'OPERATING','รายได้จากการให้บริการ'),
('4900','รายได้อื่น','Other Income','REVENUE','OTHER_INCOME','CREDIT',TRUE,FALSE,'OPERATING','รายได้อื่น'),
('4910','ดอกเบี้ยรับ','Interest Income','REVENUE','OTHER_INCOME','CREDIT',TRUE,FALSE,'OPERATING','รายได้อื่น'),
('4920','กำไรจากการจำหน่ายสินทรัพย์','Gain on Disposal of Assets','REVENUE','OTHER_INCOME','CREDIT',TRUE,FALSE,'INVESTING','รายได้อื่น'),

-- ===== 5xxx ค่าใช้จ่าย =====
('5000','ต้นทุนการให้บริการ','Cost of Services','EXPENSE','COST_OF_SERVICE','DEBIT',FALSE,FALSE,'NONE',NULL),
('5010','เงินเดือนทีมปฏิบัติงาน','Direct Labor','EXPENSE','COST_OF_SERVICE','DEBIT',TRUE,FALSE,'OPERATING','ต้นทุนการให้บริการ'),
('5020','ค่าจ้างผู้รับเหมาช่วง','Subcontractor Fees','EXPENSE','COST_OF_SERVICE','DEBIT',TRUE,FALSE,'OPERATING','ต้นทุนการให้บริการ'),
('5030','ค่าเดินทางปฏิบัติงาน','Project Travel Expenses','EXPENSE','COST_OF_SERVICE','DEBIT',TRUE,FALSE,'OPERATING','ต้นทุนการให้บริการ'),
('5040','ค่าซอฟต์แวร์และเครื่องมือที่ใช้ในงาน','Project Software and Tools','EXPENSE','COST_OF_SERVICE','DEBIT',TRUE,FALSE,'OPERATING','ต้นทุนการให้บริการ'),

('5100','ค่าใช้จ่ายในการขายและบริหาร','Selling and Administrative Expenses','EXPENSE','SGA','DEBIT',FALSE,FALSE,'NONE',NULL),
('5110','เงินเดือนและค่าแรง','Salaries and Wages','EXPENSE','SGA','DEBIT',TRUE,FALSE,'OPERATING','ค่าใช้จ่ายในการบริหาร'),
('5111','โบนัสและสวัสดิการพนักงาน','Bonus and Employee Benefits','EXPENSE','SGA','DEBIT',TRUE,FALSE,'OPERATING','ค่าใช้จ่ายในการบริหาร'),
('5112','เงินสมทบประกันสังคม - นายจ้าง','Social Security - Employer','EXPENSE','SGA','DEBIT',TRUE,FALSE,'OPERATING','ค่าใช้จ่ายในการบริหาร'),
('5120','ค่าเช่าสำนักงาน','Office Rent','EXPENSE','SGA','DEBIT',TRUE,FALSE,'OPERATING','ค่าใช้จ่ายในการบริหาร'),
('5130','ค่าสาธารณูปโภค','Utilities','EXPENSE','SGA','DEBIT',TRUE,FALSE,'OPERATING','ค่าใช้จ่ายในการบริหาร'),
('5140','ค่าโทรศัพท์และอินเทอร์เน็ต','Telephone and Internet','EXPENSE','SGA','DEBIT',TRUE,FALSE,'OPERATING','ค่าใช้จ่ายในการบริหาร'),
('5150','ค่าธรรมเนียมวิชาชีพ','Professional Fees','EXPENSE','SGA','DEBIT',TRUE,FALSE,'OPERATING','ค่าใช้จ่ายในการบริหาร'),
('5155','ค่าใช้จ่ายการตลาดและโฆษณา','Marketing and Advertising','EXPENSE','SGA','DEBIT',TRUE,FALSE,'OPERATING','ค่าใช้จ่ายในการขาย'),
('5160','ค่าเสื่อมราคา','Depreciation Expense','EXPENSE','SGA','DEBIT',TRUE,FALSE,'NONE','ค่าใช้จ่ายในการบริหาร'),
('5161','ค่าตัดจำหน่าย','Amortization Expense','EXPENSE','SGA','DEBIT',TRUE,FALSE,'NONE','ค่าใช้จ่ายในการบริหาร'),
('5170','ค่าใช้จ่ายเบ็ดเตล็ด','Miscellaneous Expenses','EXPENSE','SGA','DEBIT',TRUE,FALSE,'OPERATING','ค่าใช้จ่ายในการบริหาร'),
('5180','หนี้สงสัยจะสูญ','Doubtful Debt Expense','EXPENSE','SGA','DEBIT',TRUE,FALSE,'NONE','ค่าใช้จ่ายในการบริหาร'),
('5185','หนี้สูญ','Bad Debt Written Off','EXPENSE','SGA','DEBIT',TRUE,FALSE,'NONE','ค่าใช้จ่ายในการบริหาร'),
('5190','ค่าธรรมเนียมธนาคาร','Bank Charges','EXPENSE','SGA','DEBIT',TRUE,FALSE,'OPERATING','ค่าใช้จ่ายในการบริหาร'),
('5195','ผลต่างเศษสตางค์','Rounding Difference','EXPENSE','SGA','DEBIT',TRUE,FALSE,'OPERATING','ค่าใช้จ่ายในการบริหาร'),
('5196','ภาษีซื้อต้องห้าม','Non-claimable Input VAT','EXPENSE','SGA','DEBIT',TRUE,FALSE,'OPERATING','ค่าใช้จ่ายในการบริหาร'),
('5197','ขาดทุนจากการจำหน่ายสินทรัพย์','Loss on Disposal of Assets','EXPENSE','SGA','DEBIT',TRUE,FALSE,'INVESTING','ค่าใช้จ่ายในการบริหาร'),

('5900','ต้นทุนทางการเงิน','Finance Costs','EXPENSE','FINANCE_COST','DEBIT',TRUE,FALSE,'FINANCING','ต้นทุนทางการเงิน'),
('5990','ภาษีเงินได้นิติบุคคล','Corporate Income Tax','EXPENSE','INCOME_TAX','DEBIT',TRUE,FALSE,'OPERATING','ค่าใช้จ่ายภาษีเงินได้');

-- ผูกบัญชีลูกเข้าบัญชีหัวข้อ
UPDATE acc.chart_of_accounts c SET parent_account_id = p.id
  FROM acc.chart_of_accounts p
 WHERE p.account_code = '1000' AND c.account_code IN ('1010','1020','1030','1040','1100','1110','1120','1130','1135','1140','1145','1150','1151','1155','1160');
UPDATE acc.chart_of_accounts c SET parent_account_id = p.id
  FROM acc.chart_of_accounts p
 WHERE p.account_code = '1500' AND c.account_code IN ('1510','1511','1520','1521','1530','1531','1540','1541');
UPDATE acc.chart_of_accounts c SET parent_account_id = p.id
  FROM acc.chart_of_accounts p
 WHERE p.account_code = '5000' AND c.account_code IN ('5010','5020','5030','5040');
UPDATE acc.chart_of_accounts c SET parent_account_id = p.id
  FROM acc.chart_of_accounts p
 WHERE p.account_code = '5100' AND c.account_code LIKE '51__' AND c.account_code <> '5100';

-- ---------------------------------------------------------------------
-- 2. แมปบทบาททางบัญชี -> บัญชีจริง
--    Posting Rule ในโค้ดต้องอ้าง key เหล่านี้เท่านั้น ห้าม hardcode รหัสบัญชี
-- ---------------------------------------------------------------------

INSERT INTO acc.account_mappings (key, account_id, description)
SELECT v.key, c.id, v.descr
  FROM (VALUES
    ('CASH_ON_HAND',        '1010','เงินสดในมือ'),
    ('BANK_DEFAULT',        '1020','บัญชีธนาคารหลัก (ใช้เมื่อไม่ระบุบัญชี)'),
    ('PETTY_CASH',          '1040','เงินสดย่อย'),
    ('AR_TRADE',            '1100','บัญชีคุมลูกหนี้การค้า'),
    ('AR_ALLOWANCE',        '1110','ค่าเผื่อผลขาดทุนด้านเครดิต'),
    ('ACCRUED_REVENUE',     '1120','รายได้ค้างรับ'),
    ('PREPAID_EXPENSE',     '1140','ค่าใช้จ่ายจ่ายล่วงหน้า'),
    ('INPUT_VAT',           '1150','ภาษีซื้อที่ใช้สิทธิได้แล้ว'),
    ('INPUT_VAT_SUSPENSE',  '1151','พักภาษีซื้อ (รอรับใบกำกับภาษี)'),
    ('VAT_REFUNDABLE',      '1155','ภาษีซื้อรอขอคืน'),
    ('WHT_RECEIVABLE',      '1160','ภาษีเงินได้ที่ถูกลูกค้าหัก ณ ที่จ่าย'),
    ('AP_TRADE',            '2000','บัญชีคุมเจ้าหนี้การค้า'),
    ('ACCRUED_EXPENSE',     '2010','ค่าใช้จ่ายค้างจ่าย'),
    ('ADVANCE_FROM_CUSTOMER','2020','เงินรับล่วงหน้าจากลูกค้า'),
    ('OUTPUT_VAT',          '2100','ภาษีขายที่ถึงกำหนดนำส่งแล้ว'),
    ('OUTPUT_VAT_SUSPENSE', '2101','พักภาษีขาย (ยังไม่ถึงจุดรับผิด)'),
    ('VAT_PAYABLE',         '2110','ภาษีมูลค่าเพิ่มค้างชำระตาม ภพ.30'),
    ('WHT_PAYABLE_PND1',    '2200','ภาษีหัก ณ ที่จ่ายพนักงานค้างนำส่ง'),
    ('WHT_PAYABLE_PND3',    '2201','ภาษีหัก ณ ที่จ่ายบุคคลธรรมดาค้างนำส่ง'),
    ('WHT_PAYABLE_PND53',   '2202','ภาษีหัก ณ ที่จ่ายนิติบุคคลค้างนำส่ง'),
    ('SSO_PAYABLE',         '2210','ประกันสังคมค้างนำส่ง'),
    ('CIT_PAYABLE',         '2300','ภาษีเงินได้นิติบุคคลค้างจ่าย'),
    ('RETAINED_EARNINGS',   '3100','กำไรสะสม'),
    ('LEGAL_RESERVE',       '3110','สำรองตามกฎหมาย'),
    ('INCOME_SUMMARY',      '3200','บัญชีสรุปผลกำไรขาดทุน (ใช้ตอนปิดบัญชี)'),
    ('SERVICE_REVENUE',     '4000','รายได้จากการให้บริการ (ค่าเริ่มต้น)'),
    ('SALES_DISCOUNT',      '4090','ส่วนลดจ่ายและรับคืน'),
    ('SALARY_EXPENSE',      '5110','เงินเดือนและค่าแรง'),
    ('SSO_EXPENSE',         '5112','เงินสมทบประกันสังคมส่วนนายจ้าง'),
    ('DEPRECIATION_EXPENSE','5160','ค่าเสื่อมราคา (ค่าเริ่มต้น)'),
    ('DOUBTFUL_DEBT',       '5180','หนี้สงสัยจะสูญ'),
    ('BAD_DEBT',            '5185','หนี้สูญ'),
    ('BANK_CHARGE',         '5190','ค่าธรรมเนียมธนาคาร'),
    ('ROUNDING_DIFF',       '5195','ผลต่างเศษสตางค์'),
    ('NON_CLAIMABLE_VAT',   '5196','ภาษีซื้อต้องห้าม'),
    ('GAIN_ON_DISPOSAL',    '4920','กำไรจากการจำหน่ายสินทรัพย์'),
    ('LOSS_ON_DISPOSAL',    '5197','ขาดทุนจากการจำหน่ายสินทรัพย์'),
    ('INCOME_TAX_EXPENSE',  '5990','ภาษีเงินได้นิติบุคคล')
  ) AS v(key, code, descr)
  JOIN acc.chart_of_accounts c ON c.account_code = v.code;

-- ---------------------------------------------------------------------
-- 3. ลำดับเลขที่เอกสาร
-- ---------------------------------------------------------------------
INSERT INTO acc.document_sequences (doc_type, year_key, prefix, pad_length, last_number, reset_cycle) VALUES
 ('INV','TEMPLATE','INV',5,0,'YEARLY'),   -- ใบแจ้งหนี้
 ('RC', 'TEMPLATE','RC', 5,0,'YEARLY'),   -- ใบเสร็จรับเงิน
 ('TXI','TEMPLATE','TI', 5,0,'YEARLY'),   -- ใบกำกับภาษี
 ('CN', 'TEMPLATE','CN', 5,0,'YEARLY'),   -- ใบลดหนี้
 ('DN', 'TEMPLATE','DN', 5,0,'YEARLY'),   -- ใบเพิ่มหนี้
 ('BL', 'TEMPLATE','BL', 5,0,'YEARLY'),   -- ใบตั้งหนี้ผู้ขาย
 ('PV', 'TEMPLATE','PV', 5,0,'YEARLY'),   -- ใบสำคัญจ่าย
 ('WHT','TEMPLATE','WT', 5,0,'YEARLY'),   -- หนังสือรับรองหัก ณ ที่จ่าย
 ('PR', 'TEMPLATE','PR', 4,0,'YEARLY'),   -- เงินเดือน
 ('JV', 'TEMPLATE','JV', 5,0,'YEARLY');   -- ใบสำคัญทั่วไป

COMMIT;
