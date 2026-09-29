-- تصحيحات العزل وCAS فوق الهجرة التاريخية دون تعديلها.
-- الهجرة 20260905030000 عادت إلى محتواها الأصلي الموثق بالبصمة
-- 582fbbd6fe8d993f9d1b764456a83861d9d0c745fef802b23be2a06ed79c8163،
-- وهذا الملف يحمل التصحيحات التي كانت قد رُقّعت فيها خطأً:
-- 1) سياسة كتابة الهويات الإدارية مشروطة ببوابة identity_write صريحة
--    بدل الاعتماد على tenant_id غير الفارغ (الذي كان يجعل أي سياق مستأجر
--    يكتب في external_identities — ومجموع OR يوسع القراءة لكل الصفوف).
-- 2) سياسة قراءة ضيقة للهويات الداخلية للجسر فقط (id LIKE 'internal:%').
-- 3) فهارس فريدة للهويات والعضويات الداخلية لدعم المعرفات الحتمية.
-- 4) سياسة UPDATE لاستهلاك معاملة الدخول عبر state_hash (pre-auth).
-- 5) فهرس عمود محسوب يمنع ازدواج config_version للمستأجر الواحد (CAS).

-- (1)+(2): إعادة تعريف سياسات external_identities إلى الشكل الصحيح.
-- ملاحظة idempotence: DROP ... IF EXISTS يجعل الترقية آمنة على إعادة التشغيل.
DROP POLICY IF EXISTS "identity_admin_write" ON "external_identities";
DROP POLICY IF EXISTS "identity_internal_lookup" ON "external_identities";
CREATE POLICY "identity_admin_write" ON "external_identities" FOR ALL
  USING (current_setting('app.identity_write', true) = '1')
  WITH CHECK (current_setting('app.identity_write', true) = '1');
CREATE POLICY "identity_internal_lookup" ON "external_identities" FOR SELECT
  USING (id LIKE 'internal:%');

-- (3): فهارس فريدة داخلية (idempotent بـIF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS "external_identities_internal_key" ON "external_identities"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "memberships_internal_key" ON "memberships"("id");

-- (4): سياسة استهلاك معاملة الدخول (idempotent عبر DROP)
DROP POLICY IF EXISTS "transaction_consume_update" ON "login_transactions";
CREATE POLICY "transaction_consume_update" ON "login_transactions" FOR UPDATE
  USING (state_hash = current_setting('app.state_hash', true));

-- (5): CAS لإعداد SSO — config_version يمنع الدهس الصامت عبر قيد فريد
-- جزئي؛ الصف الواحد لكل مستأجر مع إصداره (b/Y فوق الهجرة التاريخية).
CREATE UNIQUE INDEX IF NOT EXISTS "sso_configs_tenant_version_key"
  ON "sso_configs"("tenant_id", "config_version");

-- (6): تكملة صلاحيات التشغيل على الهوية الخارجية.
-- الهجرة التاريخية منحت SELECT فقط؛ الكتابة الإدارية عبر بوابة identity_write
-- تستلزم INSERT/UPDATE — تُنقل إلى هنا (لا تعديل هجرة تاريخية).
GRANT INSERT, UPDATE ON "external_identities" TO agentbridge_app;
