-- أرشيف حالة التشغيل الدائم
-- الغاية: مرجع استئناف دائم في L2 يبقى بعد انتهاء TTL الـL1 (Redis).
-- forward-only: لا down migration — العودة تسلم قرار إداري منفصل.
-- العزل: مفتاح مركب (tenant_id, run_id) + سياسة RLS نفسها المطبقة في بقية الجداول
-- (ENABLE+FORCE+سياسة tenant_isolation+منح للدور المقيد) — جدول بلا
-- حماية صفوف تحت الدور الحي سيُرفض كتابته فلا معنى لأرشفة بلا هذا القسم.

CREATE TABLE "run_state_archives" (
    "tenant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "snapshot_json" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "fence" BIGINT NOT NULL,
    "archived_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_state_archives_pkey" PRIMARY KEY ("tenant_id","run_id")
);

CREATE INDEX "run_state_archives_tenant_id_idx" ON "run_state_archives"("tenant_id");

-- حماية الصفوف: نفس سياسة العزل الموحدة — لا صف يُرى أو يُكتب إلا داخل
-- معاملة ضبطت app.tenant_id بنفس القيمة.
ALTER TABLE "run_state_archives" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "run_state_archives" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "run_state_archives"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- الدور المقيد يكتب ويقرأ الأرشيف — بلا BYPASSRLS أصلاً (منشأ في هجرة العزل).
GRANT SELECT, INSERT, UPDATE, DELETE ON "run_state_archives" TO agentbridge_app;
