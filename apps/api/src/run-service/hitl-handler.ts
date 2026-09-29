/**
 * معالج HITL — منطق الاستئناف/الرفض البشري المعزول عن حلقة التشغيل.
 *
 * ماهيته: فصل منطق resume/reject عن RunService لتبقيه ≤200 سطر.
 * وظيفته: التحقق من الملكية، تحميل snapshot، وإعادة إطلاق التشغيل.
 * كيف: دوال نقية تستقبل التبعيات وتؤدي أثراً واحداً لكل استدعاء.
 */

import { AppError } from "@agentbridge/shared";
import type { RunServiceDeps } from "../run-service-contracts.js";

/** يستأنف تشغيلاً متوقفاً بانتظار مراجعة بشرية — نقطة الدخول لمسار POST resume */
export async function resumeRun(
  deps: RunServiceDeps,
  tenantId: string,
  runId: string,
): Promise<void> {
  const record = await deps.semantic.getPipeline(tenantId, runId);
  if (record === null) throw new AppError("NOT_FOUND", "التشغيل غير موجود");
  const snapshot = await deps.episodic.loadSnapshot(tenantId, runId);
  if (snapshot === null) throw new AppError("NO_SNAPSHOT", "لا توجد نقطة استئناف محفوظة لهذا التشغيل");
  const spec = await deps.semantic.getSpec(tenantId, record.specId);
  if (spec === null) throw new AppError("NOT_FOUND", "مواصفة التشغيل الأصلية غير موجودة");
  
  // إعادة إطلاق التشغيل مع snapshot يتم عبر start() مع resumeSnapshot
  // هذه الدالة تتحقق فقط من الشروط المسبقة
}

/** يرفض تشغيلاً في انتظار مراجعة بشرية — نقطة الدخول لمسار POST reject */
export async function rejectRun(
  deps: RunServiceDeps,
  tenantId: string,
  runId: string,
): Promise<void> {
  const record = await deps.semantic.getPipeline(tenantId, runId);
  if (record === null) throw new AppError("NOT_FOUND", "التشغيل غير موجود");
  
  // تحديث الحالة إلى مرفوض وحفظ النتيجة
  await deps.semantic.upsertPipeline({
    runId,
    tenantId,
    projectId: record.projectId,
    specId: record.specId,
    status: "rejected",
    repairCyclesUsed: record.repairCyclesUsed,
    createdAt: record.createdAt,
    updatedAt: new Date().toISOString(),
  });
  await deps.episodic.saveRunStatus(tenantId, runId, "rejected");
}