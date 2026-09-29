/**
 * مسار خطوط الأنابيب — دورة الحياة كاملة عبر HTTP:
 *   POST تشغيل (مع بوابة مراجعة بشرية اختيارية) → 202 {runId}
 *   GET list / status / events (NDJSON) / stream (SSE)
 *   POST resume (اعتماد HITL) · POST reject (رفض بشري)
 * كل قراءة تنطلق من نطاق مستأجر المصادقة — لا استثناء.
 * المخرجات (tools/package/certificate/badge) والبث مجزأة في ملفاتها الخاصة.
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, Errors } from "@agentbridge/shared";
import { newRunId } from "@agentbridge/infra";
import { computeArtifactsHash } from "@agentbridge/evaluator";
import { requirePermission } from "../plugins/auth.plugin.js";
import { MAX_CONCURRENT_RUNS_PER_TENANT } from "../plugins/rate-limit.plugin.js";
import { HITL_APPROVAL_TTL_MS_DEFAULT, digestOfSnapshot, signHitlApproval, verifyHitlApproval } from "../run-service/hitl-approval.js";
import { readSnapshotView } from "../run-service/snapshot-read.js";
import type { ApiContainer } from "../container.js";
import { sendNdjsonEvents, sendSseStream } from "./pipeline-streams.js";

const StartPipelineBody = z.object({
  projectId: z.string().min(1),
  specId: z.string().min(1),
  /** مراجعة بشرية قبل إصدار الشهادة: يتوقف التشغيل بعد evaluate */
  requireApproval: z.boolean().optional(),
});

export function registerPipelineRoutes(app: FastifyInstance, container: ApiContainer): void {
  app.get("/pipelines", async (request) => {
    const tenantId = requirePermission(request, "resource:read").tenantId;
    const all = await container.semantic.listPipelines(tenantId);
    return {
      pipelines: all
        .map((record) => ({ runId: record.runId, status: record.status, createdAt: record.createdAt }))
        .reverse(),
    };
  });

  app.post("/pipelines", async (request, reply) => {
    const tenantId = requirePermission(request, "pipeline:run").tenantId;
    const parsed = StartPipelineBody.safeParse(request.body);
    if (!parsed.success) throw Errors.invalidInput("projectId وspecId حقول إلزامية");

    const project = await container.semantic.getProject(tenantId, parsed.data.projectId);
    if (project === null) throw new AppError("NOT_FOUND", "المشروع غير موجود");
    const spec = await container.semantic.getSpec(tenantId, parsed.data.specId);
    if (spec === null) throw new AppError("NOT_FOUND", "المواصفة غير موجودة");

    // سقف العمليات المكلفة: لا استهلاك غير محدود لسعة التوليد
    if (container.runs.activeCountFor(tenantId) >= MAX_CONCURRENT_RUNS_PER_TENANT) {
      throw new AppError("TOO_MANY_ACTIVE_RUNS", `بلغ المستأجر سقف ${MAX_CONCURRENT_RUNS_PER_TENANT} تشغيلات متزامنة — انتظر اكتمال أحد التشغيلات`, false, "warning");
    }

    const runId = newRunId();
    await container.semantic.upsertPipeline({
      runId,
      tenantId,
      projectId: project.projectId,
      specId: spec.specId,
      status: "running",
      repairCyclesUsed: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    container.runs.start({
      runId,
      tenantId,
      projectId: project.projectId,
      specId: spec.specId,
      rawSpec: spec.content,
      ...(parsed.data.requireApproval === true
        ? { suspendAfter: "evaluate" as const }
        : container.suspendAfter !== undefined
          ? { suspendAfter: container.suspendAfter }
          : {}),
      // مصدره إعداد الخادم الموثوق حصراً — لا يُقرأ من جسم الطلب
      ...(container.liveProbes === true ? { liveProbes: true } : {}),
    });
    return reply.code(202).send({
      runId,
      status: "running",
      statusPath: `/pipelines/${runId}/status`,
      eventsPath: `/pipelines/${runId}/events`,
    });
  });

  app.get("/pipelines/:runId/status", async (request) => {
    const tenantId = requirePermission(request, "resource:read").tenantId;
    const { runId } = request.params as { runId: string };
    const record = await container.semantic.getPipeline(tenantId, runId);
    if (record === null) throw new AppError("NOT_FOUND", "التشغيل غير موجود");
    return {
      runId: record.runId,
      status: record.status,
      ...(record.stoppedAt !== undefined ? { stoppedAt: record.stoppedAt } : {}),
      repairCyclesUsed: record.repairCyclesUsed,
    };
  });

  app.get("/pipelines/:runId/events", async (request, reply) => {
    return sendNdjsonEvents(container, requirePermission(request, "resource:read").tenantId, (request.params as { runId: string }).runId, reply);
  });

  // SSE حقيقي بجانب NDJSON — يبث نفس الأحداث بصيغة text/event-stream
  app.get("/pipelines/:runId/stream", async (request, reply) => {
    return sendSseStream(container, requirePermission(request, "resource:read").tenantId, (request.params as { runId: string }).runId, request, reply);
  });

  /**
   * اعتماد المراجع البشري — يصدر تذكرة موقعة خادمياً مربطة
   * بـrunId/tenantId وببصمة snapshot الحالية وببصمة artifact. التذكرة لا
   * تُقبل في resume بعد أي تغير لاحق للمخرجات، ولا تُستخدم مرتين.
   */
  app.post("/pipelines/:runId/approve", async (request, reply) => {
    const context = requirePermission(request, "pipeline:review");
    const { runId } = request.params as { runId: string };
    const record = await container.semantic.getPipeline(context.tenantId, runId);
    if (record === null) throw new AppError("NOT_FOUND", "التشغيل غير موجود");
    let snapshot = await container.episodic.loadSnapshot(context.tenantId, runId);
    if (snapshot === null && container.runs !== undefined) {
      // بعد انتهاء TTL: الأرشيف الدائم هو المرجع
      const archived = (await container.runArchive.latest(context.tenantId, runId))?.snapshotJson ?? null;
      if (archived !== null) snapshot = archived;
    }
    if (snapshot === null) throw new AppError("NO_SNAPSHOT", "لا توجد نقطة استئناف لهذا التشغيل");
    const artifactDigest = extractArtifactDigest(snapshot, container.snapshotKeyRing);
    const now = new Date().toISOString();
    const ticket = signHitlApproval({
      ticket: {
        jti: randomUUID(),
        runId,
        tenantId: context.tenantId,
        stage: record.stoppedAt ?? record.status,
        snapshotDigest: digestOfSnapshot(snapshot),
        artifactDigest,
        approvedBy: context.principal.subjectId,
        authorizationVersion: context.principal.authorizationVersion,
        issuedAt: now,
        expiresAt: new Date(Date.parse(now) + HITL_APPROVAL_TTL_MS_DEFAULT).toISOString(),
      },
      material: container.hitl.material,
    });
    await container.audit.record({ tenantId: context.tenantId, runId,   // سجل التدقيق يقيد stage بأنواع المراحل — حدث الاعتماد يُنسب للمرحلة
  // المتوقفة نفسها؛ stoppedAt مخزن نصاً فالتحويل هنا موثق لا صامت
  stage: (record.stoppedAt ?? "certify") as import("@agentbridge/shared").StageId, decision: "approve_issued", abstractedPayload: `تذكرة موافقة لـ${context.principal.subjectId}`, at: now });
    return reply.code(201).send({ ticket });
  });

  /**
   * الاستئناف يستلزم تذكرة موافقة صالحة في ترويسة
   * x-hitl-approval — توقيع/هوية/بصمات/تخويل/أحادية استخدام تتحقق كلياً
   * قبل أي إطلاق. لا موافقة = لا استئناف (فشل مغلق).
   */
  app.post("/pipelines/:runId/resume", async (request, reply) => {
    const context = requirePermission(request, "pipeline:review");
    const { runId } = request.params as { runId: string };
    // الترتيب ملزم: أخطاء الحالة القائمة (409/NO_SNAPSHOT) تسبق اشتراط
    // التذكرة — حفظ دلالات المسار القائمة لا تغييرها
    const record = await container.semantic.getPipeline(context.tenantId, runId);
    if (record === null) throw new AppError("NOT_FOUND", "التشغيل غير موجود");
    if (container.runs.isRunning(runId)) {
      throw new AppError("RUN_ALREADY_ACTIVE", "التشغيل جارٍ بالفعل ولا يقبل استئنافاً موازياً");
    }
    let snapshot = await container.episodic.loadSnapshot(context.tenantId, runId);
    if (snapshot === null) {
      const archived = (await container.runArchive.latest(context.tenantId, runId))?.snapshotJson ?? null;
      if (archived !== null) snapshot = archived;
    }
    if (snapshot === null) throw new AppError("NO_SNAPSHOT", "لا توجد نقطة استئناف محفوظة لهذا التشغيل");
    // بلا تذكرة موافقة صالحة لا استئناف إطلاقاً (فشل مغلق)
    const approvalHeader = request.headers["x-hitl-approval"];
    if (typeof approvalHeader !== "string" || approvalHeader.length === 0) {
      throw new AppError("APPROVAL_REQUIRED", "الاستئناف يستلزم تذكرة موافقة بشرية من مسار approve أولاً", false, "warning");
    }
    const verdict = await verifyHitlApproval({
      envelopeJson: approvalHeader,
      // الحلقة من مادة الإعداد الثابتة — النسخ كلها تتحقق بنفس المفتاح
      keyRing: new Map([[container.hitl.material.keyId, container.hitl.material.publicKey]]),
      expected: {
        runId,
        tenantId: context.tenantId,
        snapshotDigest: digestOfSnapshot(snapshot),
        artifactDigest: extractArtifactDigest(snapshot, container.snapshotKeyRing),
        requesterSubjectId: context.principal.subjectId,
        currentAuthorizationVersion: context.principal.authorizationVersion,
      },
      consumed: container.hitl.consumed,
    });
    if (!verdict.ok) throw verdict.error;
    await container.runs.resume(context.tenantId, runId);
    return reply.code(202).send({ runId, status: "running" });
  });

  app.post("/pipelines/:runId/reject", async (request, reply) => {
    const tenantId = requirePermission(request, "pipeline:review").tenantId;
    const { runId } = request.params as { runId: string };
    const record = await container.semantic.getPipeline(tenantId, runId);
    if (record === null) throw new AppError("NOT_FOUND", "التشغيل غير موجود");
    if (container.runs.isRunning(runId)) {
      throw new AppError("RUN_ALREADY_ACTIVE", "لا يُرفض تشغيل جارٍ — انتظر توقفه أو اكتماله");
    }
    await container.semantic.upsertPipeline({ ...record, status: "needs_human", updatedAt: new Date().toISOString() });
    await container.episodic.saveRunStatus(tenantId, runId, "needs_human");
    return reply.code(200).send({ runId, status: "needs_human" });
  });
}


/** يستخرج بصمة artifact من مظروف snapshot الموقّع — "none" قبل توليده */
function extractArtifactDigest(snapshotJson: string, keyRing: Parameters<typeof readSnapshotView>[1]): string {
  // استخراج البصمة بحلقة تحقق الإعداد — مفتاح عابر خاطئ يجعل الربط "none" بلا معنى
  const artifact = readSnapshotView(snapshotJson, keyRing)?.data.artifact;
  return artifact === undefined ? "none" : computeArtifactsHash(artifact);
}
