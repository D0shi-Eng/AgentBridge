-- ترقية الهوية: دورة إعداد SSO غير قابلة لإعادة الاستخدام وتضييق سياسة الهويات الداخلية.
-- لا تعديل لأي هجرة سابقة — كل التصحيحات هنا تراكمية فوقها زمنياً.
--
-- (أ) سبب أمني (ثغرة ABA): معاملة الدخول كانت تقارن config_version الرقمي
--     فقط؛ حذف الإعداد وإعادة إنشائه يعيد العداد إلى 1 فتُقبل معاملة قديمة
--     للإعداد الجديد. الهوية الثابتة config_instance_id (UUID قوي عند كل
--     إنشاء) تكسر ذلك: التحديث يثبتها والحذف/الإعادة تولّد جديداً —
--     المعاملة التي خزنت هوية قديمة لن تطابق الإعداد الجديد أبداً.
-- (ب) سبب أمني (تضيق قراءة): سياسة identity_internal_lookup السابقة كانت
--     USING (id LIKE 'internal:%') أي مسح عريض لكل الهويات الداخلية —
--     مرفوض. بديلها: lookup منفرد مشتق من app.credential_id بالتحديد،
--     بلا wildcard وبلا أي SELECT شامل.

-- (أ1) عمود الهوية الثابتة لدورة الإعداد — NULL ممنوع بعد التعبئة.
ALTER TABLE "sso_configs" ADD COLUMN IF NOT EXISTS "config_instance_id" TEXT;

-- (أ2) تعبئة idempotent للصفوف القائمة: هوية عشوائية قوية لكل صف —
-- لا قيمة حتمية مشتقة (تكرار الحذف/الإعادة لا يعيد نفس الهوية أمنياً).
DO $$
DECLARE
  row_id TEXT;
BEGIN
  FOR row_id IN SELECT "tenant_id" FROM "sso_configs" WHERE "config_instance_id" IS NULL LOOP
    -- gen_random_uuid() أساسي في PostgreSQL 13+ (بلا إضافات) — عشوائية قوية
    UPDATE "sso_configs"
    SET "config_instance_id" = replace(gen_random_uuid()::text, '-', '')
    WHERE "tenant_id" = row_id AND "config_instance_id" IS NULL;
  END LOOP;
END $$;

-- (أ3) لا صف بلا هوية دورة بعد الآن.
ALTER TABLE "sso_configs" ALTER COLUMN "config_instance_id" SET NOT NULL;

-- (أ4) عمود المعاملة يسجل هوية دورة الإعداد التي بدأت عندها.
ALTER TABLE "login_transactions" ADD COLUMN IF NOT EXISTS "config_instance_id" TEXT;

-- (أ5) CAS الدورة: تغيير الهوية بتحديث الصف مستحيل من المسار العادي —
-- قيد جزئي يمنع الصفوف الجديدة بدون عمود معبأ (دفاع عمق؛ المسار يملؤه دائماً).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sso_configs_instance_not_null_chk'
  ) THEN
    ALTER TABLE "sso_configs" ADD CONSTRAINT "sso_configs_instance_not_null_chk"
      CHECK ("config_instance_id" IS NOT NULL AND length("config_instance_id") >= 32);
  END IF;
END $$;

-- (ب) تضييق سياسة الهويات الداخلية: إلغاء wildcard واستبدالها بlookup
-- حرفي مشتق من credential فقط — أي سياق آخر يرى صفر صفوف (fail-closed).
DROP POLICY IF EXISTS "identity_internal_lookup" ON "external_identities";
CREATE POLICY "identity_internal_lookup" ON "external_identities" FOR SELECT
  USING (
    "issuer" = 'urn:agentbridge:internal'
    AND "subject" = current_setting('app.credential_id', true)
    AND "id" = 'internal:' || current_setting('app.credential_id', true)
  );

-- (ج) GRANT للجداول المعدلة على دور التشغيل مقيد بلا تفريع — العمودان
-- الجديدان يدخولان تلقائياً ضمن SELECT/INSERT القائمة من الهجرة التاريخية
-- (صلاحيات مستوى الجدول)، لذالا GRANT إضافي مطلوب للأعمدة الجديدة.
