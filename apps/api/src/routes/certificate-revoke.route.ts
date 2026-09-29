/**
 * مسار إبطال الشهادات — دورة الحياة لا تكتمل بالمنح/الرفض
 * وحدهما؛ تسريب مفتاح أو قرار أمني لاحق يستوجب إبطالاً موثقاً.
 *
 * POST /pipelines/:runId/certificate/revoke — داخل نطاق مستأجر المصادقة
 * وبصلاحية مراجعة (pipeline:review نفسها سلطة قرار HITL). الصف يُلحق في
 * certificate_revocations (إلحاق فقط — لا تحديث ولا حذف) ويقيد في سجل
 * التدقيق، ويجعل /verify والشارة والحزمة ترفض فوراً بسبب revoked.
 * الإبطال المكرر 409 صريح — لا نجاح صامت يخفي ازدواجية القرار.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "@agentbridge/shared";
import { requirePermission } from "../plugins/auth.plugin.js";
import type { ApiContainer } from "../container.js";
import { assertSafeRunId } from "./pipeline-outputs.js";

/** سبب الإبطال: نص قصير موثق من صاحب القرار — يُنقّى ولا يُعرض خاماً */
const RevokeBody = z.object({
  reason: z.string().min(3).max(200),
});

export function registerCertificateRevokeRoutes(app: FastifyInstance, container: ApiContainer): void {
  app.post("/pipelines/:runId/certificate/revoke", async (request, reply) => {
    const context = requirePermission(request, "pipeline:review");
    const { runId } = request.params as { runId: string };
    // نفس بوابة runId البنيوية في مسارات المخرجات — لا حقن ترويسات/سجلات
    assertSafeRunId(runId);
    const parsed = RevokeBody.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError("INVALID_INPUT", "سبب الإبطال (reason) نص إلزامي بين 3 و200 محرف");
    }

    const record = await container.semantic.getPipeline(context.tenantId, runId);
    if (record === null) throw new AppError("NOT_FOUND", "التشغيل غير موجود");
    const certificate = await container.semantic.getCertificate(context.tenantId, runId);
    if (certificate === null) throw new AppError("NOT_FOUND", "لا توجد شهادة لهذا التشغيل في نطاقك");

    // الإبطال إلحاق فقط: التكرار يرفض 409 بدل نجاح مضلل (قرار واحد نهائي)
    const existing = await container.semantic.getRevocationByVerificationId(certificate.verificationId);
    if (existing !== null) {
      throw new AppError("CERT_ALREADY_REVOKED", "هذه الشهادة ملغاة سابقاً — الإبطال نهائي غير قابل للتكرار", false, "warning");
    }
    const revokedAt = new Date().toISOString();
    await container.semantic.revokeCertificate({
      tenantId: context.tenantId,
      runId,
      verificationId: certificate.verificationId,
      reason: parsed.data.reason,
      revokedAt,
    });
    // القرار يُقيد في سلسلة التدقيق — بلا نص السبب الخام (تجريد موحد)
    await container.audit.record({
      tenantId: context.tenantId,
      runId,
      stage: "certify",
      decision: "certificate_revoked",
      abstractedPayload: `أُبطلت الشهادة ${certificate.verificationId} برمز ${parsed.data.reason.length} محرفاً`,
      at: revokedAt,
    });
    return reply.code(200).send({
      runId,
      verificationId: certificate.verificationId,
      revoked: true,
      revokedAt,
    });
  });
}
