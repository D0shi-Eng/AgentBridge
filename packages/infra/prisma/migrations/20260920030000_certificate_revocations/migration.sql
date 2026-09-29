-- جدول إبطال الشهادات: دورة حياة كاملة granted/denied/
-- revoked/expired عبر /verify. الإبطال إلحاق فقط (لا UPDATE ولا DELETE) —
-- قرار نهائي بلا تراجع صامت، وسياسة exact_lookup الضيقة تتيح للتحقق العام
-- قراءة صف الإبطال برقم التحقق حصراً بلا أي كشف لمستأجر أو تشغيل.

CREATE TABLE "certificate_revocations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "verification_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_revocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "certificate_revocations_verification_id_key" ON "certificate_revocations"("verification_id");
CREATE INDEX "certificate_revocations_tenant_id_idx" ON "certificate_revocations"("tenant_id");

ALTER TABLE "certificate_revocations" ADD CONSTRAINT "certificate_revocations_tenant_id_run_id_fkey"
  FOREIGN KEY ("tenant_id","run_id") REFERENCES "pipelines"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- عزل المستأجر الموحد: FORCE RLS + سياسة app.tenant_id داخل المعاملة نفسها
ALTER TABLE "certificate_revocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "certificate_revocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "certificate_revocations"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- منفذ pre-auth ضيق للتحقق العام (نمط verification_exact_lookup القائم):
-- يطابق صف الإبطال بقيمة lookup محلية داخل المعاملة فقط — لا استعلام بلا مفتاح
CREATE POLICY revocation_exact_lookup ON "certificate_revocations" FOR SELECT
  USING (verification_id = current_setting('app.verification_id', true));

-- إلحاق فقط: لا UPDATE ولا DELETE أصلاً — الإبطال نهائي والتاريخ يبقى
GRANT SELECT, INSERT ON "certificate_revocations" TO agentbridge_app;
