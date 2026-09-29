-- إغلاق انحراف login_transactions.config_instance_id.
-- لا تعديل لأي هجرة سابقة ولو بحرف واحد — هذه هجرة لاحقة لكل ما سبق زمنياً.
--
-- العيب المثبت: هجرة SSO السابقة أضافت العمود nullable (سطر 35 من هجرتها) بلا تعبئة ولا
-- SET NOT NULL، بينما schema.prisma يصرّحه required — أي صف قديم (NULL)
-- يكسر قراءته عبر Prisma ويفتح باباً لمعاملة بلا هوية دورة (ABA جزئي).
--
-- استحالة التطابق (توثيق السبب 6/9): مولدات الهوية الشرعية اثنتان فقط —
-- randomOpaqueToken (base64url بلا نقطتين) وهوية الإعداد (hex بلا شرطات) —
-- وقيمتا backfill تحويان ':' الذي لا تنتجه أي منهما، فلا يمكن لقيمة قديمة
-- أن تطابق إعداد SSO حالياً أو مستقبلاً بنيوياً لا مصادفةً.

-- (1) القيم القديمة النطاق المنفصل: legacy-orphan:<32hex> — طول ≥ 32 وإعلان
--     الإبطال ظاهر في القيمة نفسها (لا حذف صامت).
UPDATE "login_transactions"
   SET "config_instance_id" = 'legacy-orphan:' || replace(gen_random_uuid()::text, '-', ''),
       "expires_at" = LEAST("expires_at", CURRENT_TIMESTAMP)
 WHERE "config_instance_id" IS NULL;

-- (2) فرض NOT NULL بعد التعبئة — العمود صادق على القاعدة كمخطط Prisma.
ALTER TABLE "login_transactions" ALTER COLUMN "config_instance_id" SET NOT NULL;

-- (3) قيد شامل يمنع القيم غير الصحيحة (idempotent بفحص pg_constraint).
--     الشكلان المسموحان حصراً:
--     أ) هوية شرعية: length >= 32 وبلا ':' (base64url أو hex — مولدات الخادم).
--     ب) شاهد تاريخي مبطل: 'legacy-orphan:%' — لا يطابق أي إعداد حي أبداً
--        لأن هويات الإعدادات الحية بلا ':' بنيوياً؛ فيبقى ABA مغلقاً.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'login_tx_instance_domain_chk'
  ) THEN
    ALTER TABLE "login_transactions" ADD CONSTRAINT "login_tx_instance_domain_chk"
      CHECK (
        (length("config_instance_id") >= 32 AND position(':' in "config_instance_id") = 0)
        OR "config_instance_id" LIKE 'legacy-orphan:%'
      );
  END IF;
END $$;

-- (4) بوابة الكتابة الإدارية لا تمنح SELECT أوسع.
--     سياسة identity_admin_write السابقة كانت FOR ALL — أي أن identity_write='1'
--     يفتح قراءة كل الهويات. تُستبدل بسياستي INSERT وUPDATE حصراً؛ والقراءة
--     تبقى مقصورة على exact (issuer+subject) وinternal (credential).
DROP POLICY IF EXISTS "identity_admin_write" ON "external_identities";
CREATE POLICY "identity_admin_insert" ON "external_identities" FOR INSERT
  WITH CHECK (current_setting('app.identity_write', true) = '1');
CREATE POLICY "identity_admin_update" ON "external_identities" FOR UPDATE
  USING (current_setting('app.identity_write', true) = '1')
  WITH CHECK (current_setting('app.identity_write', true) = '1');
