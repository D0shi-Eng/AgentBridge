/**
 * قراءة مخارج التشغيل: الأدوات من نقطة الاستئناف والحزمة والشهادة والشارة.
 * كل مستخلص هنا يستقبل tenantId من المصادقة فقط ولا يقبل tenant من الطلب.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { AppError, ToolDesignSchema } from "@agentbridge/shared";
import { buildDeflatedZip, buildStoredZip } from "@agentbridge/infra";
import { renderBadge } from "@agentbridge/evaluator";
import { requirePermission } from "../plugins/auth.plugin.js";
import type { ApiContainer } from "../container.js";
import { readSnapshotView } from "../run-service/snapshot-read.js";
import { buildVerifyUrl } from "./badge-verify-url.js";

/**
 * بوابة معرف التشغيل: معرف تشغيل سليم بنيوياً — يمنع حقن الترويسات والمسارات
 * عبر اسم التنزيل. runId يولَّد خادمياً بهذا النمط، فأي قيمة خارجه
 * من الطلب الأصلي مرفضة قبل بناء أي ترويسة content-disposition.
 */
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

/** بوابة معرف التشغيل — تصدَّر لمسار الإبطال ليطابق نفس الحاجز */
export function assertSafeRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) throw new AppError("NOT_FOUND", "التشغيل غير موجود");
}

/** يجلب شهادة معتمدة: غيابها الكلي 404 (لا كشف عبور المستأجرين)،
 * وحضورها بغير منح 403 موثق، وإبطالها لاحقاً 403 revoked:
 * شهادة ملغاة لا تسلّم حزمة ولا شارة نجاح بعدها. */
async function requireGrantedCertificate(container: ApiContainer, tenantId: string, runId: string) {
  const certificate = await container.semantic.getCertificate(tenantId, runId);
  if (certificate === null) {
    throw new AppError("NOT_FOUND", "لا توجد شهادة لهذا التشغيل في نطاقك");
  }
  if (certificate.granted !== true) {
    throw new AppError("ARTIFACT_NOT_CERTIFIED", "حزمة هذا التشغيل غير معتمدة — لا تُسلَّم كحزمة إنتاجية");
  }
  const revocation = await container.semantic.getRevocationByVerificationId(certificate.verificationId);
  if (revocation !== null) {
    throw new AppError("ARTIFACT_REVOKED", "هذه الشهادة ملغاة — لا حزمة ولا شارة بعد الإبطال", false, "warning");
  }
  return certificate;
}

/** أدوات التصميم المقروءة من snapshot — ترفض غياب التصميم بدل إخفائه */
export async function readTools(container: ApiContainer, tenantId: string, runId: string): Promise<unknown> {
  const record = await container.semantic.getPipeline(tenantId, runId);
  if (record === null) throw new AppError("NOT_FOUND", "التشغيل غير موجود");
  const snapshot = await container.episodic.loadSnapshot(tenantId, runId);
  if (snapshot === null) throw new AppError("NO_SNAPSHOT", "لم تكتمل مرحلة التصميم بعد");
  // التحقق بحلقة الإعداد (مفتاح ثابت + مفاتيح الدوران) لا مفتاح العملية
  const designsRaw = readSnapshotView(snapshot, container.snapshotKeyRing)?.data.designs;
  const parsed = z.array(ToolDesignSchema).safeParse(designsRaw);
  if (!parsed.success) throw new AppError("NO_SNAPSHOT", "أدوات التصميم غير متاحة بعد في نقطة الاستئناف");
  return {
    tools: parsed.data.map((design) => ({
      name: design.name,
      description: design.description,
      endpointIds: design.endpointIds,
      parameters: Object.keys(design.parameters),
    })),
  };
}

/** تنزيل حزمة ZIP — المعتمد فقط، والضغط فوق 100KB حصراً */
export async function packageDownload(
  container: ApiContainer,
  tenantId: string,
  runId: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  assertSafeRunId(runId);
  await requireGrantedCertificate(container, tenantId, runId);
  const artifact = await container.semantic.getArtifact(tenantId, runId);
  if (artifact === null) throw new AppError("NOT_FOUND", "لا توجد حزمة محفوظة لهذا التشغيل");
  const parsed = JSON.parse(artifact.artifactJson) as { files: { path: string; contents: string }[] };
  const total = parsed.files.reduce((s, f) => s + f.contents.length, 0);
  const zip = total > 100 * 1024 ? buildDeflatedZip(parsed.files) : buildStoredZip(parsed.files);
  reply.header("content-type", "application/zip");
  reply.header("content-disposition", `attachment; filename="generated-server-${runId.slice(0, 8)}.zip"`);
  return reply.send(zip);
}

/** شهادة JSON منحتة أو مرفوضة — القرار السلبي أيضاً ملف تدقيق خارجي */
export async function certificateDownload(
  container: ApiContainer,
  tenantId: string,
  runId: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  assertSafeRunId(runId);
  const certificate = await container.semantic.getCertificate(tenantId, runId);
  if (certificate === null) throw new AppError("NOT_FOUND", "لم يُصدر هذا التشغيل شهادة");
  reply.header("content-type", "application/json; charset=utf-8");
  reply.header("content-disposition", `attachment; filename="certificate-${certificate.runId}.json"`);
  return reply.send(certificate.certificateJson);
}

/** شارة SVG — للمعتمد حصراً: شارة غير منححة = تضليل علني */
export async function badgeDownload(
  container: ApiContainer,
  tenantId: string,
  runId: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  assertSafeRunId(runId);
  const certificate = await requireGrantedCertificate(container, tenantId, runId);
  const verifyUrl = buildVerifyUrl(container.config, certificate.verificationId);
  reply.header("content-type", "image/svg+xml; charset=utf-8");
  reply.header("content-disposition", `attachment; filename="badge-${runId}.svg"`);
  return reply.send(renderBadge(JSON.parse(certificate.certificateJson), { verifyUrl }));
}

export function registerPipelineOutputs(app: FastifyInstance, container: ApiContainer): void {
  const guard = (request: import("fastify").FastifyRequest, permission: Parameters<typeof requirePermission>[1]) => requirePermission(request, permission).tenantId;
  app.get("/pipelines/:runId/tools", async (request) => {
    const tenantId = guard(request, "resource:read");
    return readTools(container, tenantId, (request.params as { runId: string }).runId);
  });
  app.get("/pipelines/:runId/package", async (request, reply) => {
    const tenantId = guard(request, "artifact:read");
    return packageDownload(container, tenantId, (request.params as { runId: string }).runId, reply);
  });
  app.get("/pipelines/:runId/certificate", async (request, reply) => {
    const tenantId = guard(request, "artifact:read");
    return certificateDownload(container, tenantId, (request.params as { runId: string }).runId, reply);
  });
  app.get("/pipelines/:runId/badge", async (request, reply) => {
    const tenantId = guard(request, "artifact:read");
    return badgeDownload(container, tenantId, (request.params as { runId: string }).runId, reply);
  });
}
