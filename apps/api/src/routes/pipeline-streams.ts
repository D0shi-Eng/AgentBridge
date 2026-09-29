/**
 * بث أحداث التشغيل (NDJSON + SSE) — مستخلص من مسار pipelines.
 * كلا الشكلين يبثان نفس الأحداث؛ SSE عبر reply.raw لأن الصيغة تحتاج
 * كتابة متسلسلة مباشرة على socket مع إغلاق عند انقطاع العميل.
 * SSE فوق اتصال منظم — heartbeat + id + مؤشر Last-Event-ID
 * + حصة اتصالات لكل مستأجر + فصل العميل البطيء (يستأنف من cursor).
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "@agentbridge/shared";
import type { ApiContainer } from "../container.js";
import { SseConnection, sseQuota, SSE_MAX_CONNECTIONS_PER_TENANT as SSE_QUOTA_LIMIT } from "../run-service/sse-connection.js";

/** بث NDJSON الحي — استهلاك عبر fetch/stream من العميل */
export async function sendNdjsonEvents(
  container: ApiContainer,
  tenantId: string,
  runId: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const stream = await container.runs.openEventStream(tenantId, runId);
  if (stream === null) throw new AppError("NOT_FOUND", "التشغيل غير موجود");
  reply.header("content-type", "application/x-ndjson; charset=utf-8");
  return reply.send(stream);
}

/** بث SSE نفس الأحداث — إعادة فورية بعد المؤشر ثم اشتراك حي منظم */
export async function sendSseStream(
  container: ApiContainer,
  tenantId: string,
  runId: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  // الحصة الموزعة فوق Redis عند live — العدّ مشترك بين
  // النسخ. غياب المخزن (تطوير) يبقى العدّاد المحلي العملية الموثق.
  const distributed = container.sseQuotaStore;
  let acquired = false;
  try {
    acquired = distributed !== undefined ? await distributed.acquire(tenantId) : sseQuota.acquire(tenantId);
  } catch (error) {
    // فشل مغلق معلن: تعطل مخزن الحصة يمنع اتصالاً جديداً بدل تجاوز السقف صامتاً
    request.log.warn({ err: error }, "sse_quota_store_down");
    return reply.code(503).send({
      error: "SSE_QUOTA_STORE_DOWN",
      message: "مخزن حصص البث غير متاح — أعد المحاولة بعد قليل",
    });
  }
  if (!acquired) {
    return reply.code(503).send({
      error: "SSE_QUOTA_EXCEEDED",
      message: `بلغ المستأجر حصة اتصالات البث (${SSE_QUOTA_LIMIT}) — أغلق اتصالاً أو انتظر`,
    });
  }
  const source = await container.runs.openEventSource(tenantId, runId);
  if (source === null) {
    void releaseQuota(distributed, sseQuota, tenantId, request);
    throw new AppError("NOT_FOUND", "التشغيل غير موجود");
  }
  reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  // تجديد حصة المستأجر مع كل heartbeat — فشله العابر لا يسقط اتصالاً حياً
  const connection = new SseConnection(reply.raw, {
    ...(distributed !== undefined
      ? { onHeartbeat: (): void => { void distributed.refresh(tenantId).catch(() => undefined); } }
      : {}),
  });
  // مؤشر الاستئناف: Last-Event-ID = at لآخر حدث استلمه العميل — الأقدم لا يُعاد
  const lastEventId = request.headers["last-event-id"];
  connection.replay(source.replayed, typeof lastEventId === "string" ? lastEventId : undefined);
  // onDone قد يُستدعى متزامناً أثناء subscribe نفسها (تشغيل نهائي
  // سبق اكتماله) — التعريف قبل الاشتراك + علم إنهاء يجعل finish مكرر الأمان
  // ولا يقع في منطقة TDZ، ولا يحرر حصة الحصة مرتين عند تزامن onDone مع close.
  let unsubscribe: (() => void) | null = null;
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    if (unsubscribe !== null) unsubscribe();
    void releaseQuota(distributed, sseQuota, tenantId, request);
    connection.close();
  };
  unsubscribe = source.subscribe({
    onEvent: (event) => connection.sendEvent(event),
    onDone: () => finish(),
  });
  request.raw.on("close", () => finish());
  return reply;
}

/**
 * تحرير مقعد الحصة مع تسجيل فشله — التحرر الذاتي عبر TTL شبكة الأمان
 * يغطي الفشل العابر، لكن الفشل يُسجَّل لا يُبتلع (لا silent catch).
 */
function releaseQuota(
  distributed: ApiContainer["sseQuotaStore"],
  local: { release(tenantId: string): void },
  tenantId: string,
  request: FastifyRequest,
): Promise<void> {
  if (distributed !== undefined) {
    return distributed.release(tenantId).catch((error: unknown) => {
      request.log.warn({ err: error }, "sse_quota_release_failed");
    });
  }
  local.release(tenantId);
  return Promise.resolve();
}
