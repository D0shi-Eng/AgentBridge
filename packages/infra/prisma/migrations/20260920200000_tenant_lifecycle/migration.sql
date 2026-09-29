-- FC (الإقفال النهائي) — أعمدة دورة حياة المستأجر وفك ربط الإبطالات:
-- 1) api_credentials.expires_at: صلاحية اعتماد اختيارية — منقضٍ يرفض
--    fail-closed في المصادقة (الدوران بإصدار جديد وإلغاء قديم).
-- 2) tenants.deleted_at: قبر المستأجر بعد سير الحذف — يمنع الإحياء
--    وإعادة استخدام المعرف ويبقي الصف مرساة للتدقيق والإبطالات.
-- 3) tenants.legal_hold_until: حجز قانوني نافذ يمنع سير الحذف كلياً.
-- 4) فك FK من certificate_revocations إلى pipelines: صف الإبطال يجب أن
--    يبقى قائماً بعد مسح بيانات المستأجر التشغيلية — /verify العام يعتمد
--    عليه في رفض الشهادات المنشورة بعد موت المستأجر نفسه. الأعمدة تبقى
--    كما هي والجدول إلحاق فقط كما كان — تغيير العلاقة لا يغير العقود.
-- هذه هجرة جديدة forward-only؛ لا هجرة تاريخية تُمس.

ALTER TABLE "api_credentials" ADD COLUMN "expires_at" TIMESTAMP(3);

ALTER TABLE "tenants" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "legal_hold_until" TIMESTAMP(3);

ALTER TABLE "certificate_revocations" DROP CONSTRAINT "certificate_revocations_tenant_id_run_id_fkey";
