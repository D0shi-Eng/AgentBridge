-- سجل عمليات حذف المستأجر الدائم (تصحيح أمني موجه)
-- الغاية: سياج فعلي لسير الحذف — عملية واحدة قيد التنفيذ كحد أقصى
-- لكل مستأجر (فهرس فريد جزئي داخل القاعدة)، واستئناف من المرحلة
-- المسجلة بعد أي فشل، وإعادة إرسال إيدبوتنتية تعيد الإيصال المخزن
-- بلا وصل تدقيق مكرر.
-- forward-only: لا down migration — العودة عبر backup/restore بقرار إداري.

CREATE TABLE "tenant_deletion_operations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fence_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "receipt_json" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tenant_deletion_operations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_deletion_operations_tenant_id_status_idx"
  ON "tenant_deletion_operations"("tenant_id","status");

-- المنع الذري للتوازي: عملية واحدة قيد التنفيذ كحد أقصى لكل مستأجر —
-- فتح عملية ثانية متزامنة يصطدم بالفهرس فيرفض داخل القاعدة لا في التطبيق.
CREATE UNIQUE INDEX "tenant_deletion_operations_active_per_tenant"
  ON "tenant_deletion_operations"("tenant_id")
  WHERE "status" = 'in_progress';

-- حماية الصفوف: نفس سياسة العزل الموحدة — لا صف يُرى أو يُكتب إلا داخل
-- معاملة ضبطت app.tenant_id بنفس القيمة.
ALTER TABLE "tenant_deletion_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_deletion_operations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_deletion_operations"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- الدور المقيد يكتب ويقرأ السجل — بلا BYPASSRLS أصلاً (كما في بقية الجداول).
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_deletion_operations" TO agentbridge_app;

-- حذف الهويات اليتيمة بعد موت مستأجرها يستلزم DELETE على
-- external_identities — المنح التاريخي حدّه INSERT,UPDATE فقط،
-- وسياسات الكتابة اللاحقة أنشأت INSERT/UPDATE حصراً. ولأن PostgreSQL يجمع سياسات
-- SELECT كشرط رؤية إضافي فوق حذف الصفوف (الخطة: delete_quals AND
-- select_quals)، فإن حذفاً بمعرف مجهول يظل محجوباً مهما كانت سياسة
-- DELETE — لذا تُضاف سياسة SELECT مسوَّرة بنفس بوابة identity_write
-- (بوابة داخلية يضبطها سير onboarding/الحذف حصراً، لا مسار API) فيصير
-- الحذف ممكناً بمعرف الهوية دون كشف أي هوية خارج تلك البوابة.
GRANT DELETE ON "external_identities" TO agentbridge_app;
DROP POLICY IF EXISTS "identity_admin_delete" ON "external_identities";
CREATE POLICY "identity_admin_delete" ON "external_identities" FOR DELETE
  USING (current_setting('app.identity_write', true) = '1');
-- قراءة مخصصة لسير الحذف فقط: تشترط بوابة الكتابة وسياق حذف صريحاً
-- (app.deletion_context) وتحصر الصفوف المسموح رؤيتها في هويات المستأجرين
-- الخارجية باستبعاد مُصدر الجسر الداخلي — فلا تتسع القراءة تحت بوابة
-- identity_write وحدها ولا مع أي سياق مستأجر عادي، وتبقى هويات الجسر
-- الداخلية مقصورة على بوابة الاعتماد حصراً (حرس اختبارات سياسة الهوية).
DROP POLICY IF EXISTS "identity_deletion_lookup" ON "external_identities";
CREATE POLICY "identity_deletion_lookup" ON "external_identities" FOR SELECT
  USING (
    current_setting('app.identity_write', true) = '1'
    AND current_setting('app.deletion_context', true) = '1'
    AND "issuer" <> 'urn:agentbridge:internal'
  );
