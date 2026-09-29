/**
 * مساعدات الطيور الحي — عمليات مشتركة بين العملية A وB.
 * كل دالة تفشل بوضوح عند أي رفض — لا صمت ولا نجاح زائف.
 */
import { expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { authHeader } from "@agentbridge/api/test-helpers";
import type { App, Tenant } from "./phoenix-types.js";

/** بدء تشغيل HITL ويعيد runId */
export async function startHitlRun(app: App, tenant: Tenant, projectId: string, specId: string): Promise<string> {
  const response = await app.inject({
    method: "POST", url: "/pipelines", headers: authHeader(tenant),
    payload: { projectId, specId, requireApproval: true },
  });
  if (response.statusCode !== 202) throw new Error(`لم يُقبل التشغيل: ${response.body}`);
  return (JSON.parse(response.body) as { runId: string }).runId;
}

/** قراءة حالة التشغيل */
export async function statusOf(app: App, tenant: Tenant, runId: string): Promise<string> {
  const response = await app.inject({ method: "GET", url: `/pipelines/${runId}/status`, headers: authHeader(tenant) });
  return (JSON.parse(response.body) as { status: string }).status;
}

/** انتظار حالة من المطلوب داخل سقف زمني صلب */
export async function waitFor(app: App, tenant: Tenant, runId: string, wanted: readonly string[]): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (wanted.includes(await statusOf(app, tenant, runId))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`انتهت المهلة دون الوصول إلى [${wanted.join("،")}]`);
}

/** نص أحداث التشغيل */
export async function eventsText(app: App, tenant: Tenant, runId: string): Promise<string> {
  const response = await app.inject({ method: "GET", url: `/pipelines/${runId}/events`, headers: authHeader(tenant) });
  return response.body;
}

/** الاستئناف في العملية B مع التصريحين الحاسمين: 202 والبادئة الحرفية */
export async function resumeAndAssert(
  app: App, tenant: Tenant, runId: string, eventsBeforeSuspension: string,
): Promise<void> {
  // التذكرة تُصدر خادمياً من هوية المراجع نفسها ثم تُستهلك مرة واحدة
  const approve = await app.inject({ method: "POST", url: `/pipelines/${runId}/approve`, headers: authHeader(tenant) });
  expect(approve.statusCode).toBe(201);
  const { ticket } = JSON.parse(approve.body) as { ticket: string };
  const resumeResponse = await app.inject({
    method: "POST", url: `/pipelines/${runId}/resume`,
    headers: { ...authHeader(tenant), "x-hitl-approval": ticket },
  });
  expect(resumeResponse.statusCode).toBe(202);
  await waitFor(app, tenant, runId, ["completed"]);
  const eventsAfterResume = await eventsText(app, tenant, runId);
  expect(eventsAfterResume.startsWith(eventsBeforeSuspension)).toBe(true);
}

/** عبث واحد مباشر في القاعدة على الصف الثاني من سلسلة التدقيق */
export async function tamperAuditRow(databaseUrl: string, tenantId: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const entries = await prisma.auditLog.findMany({
      where: { tenant_id: tenantId }, orderBy: { seq: "asc" }, take: 2,
    });
    const tamperTarget = entries[1];
    if (tamperTarget === undefined) throw new Error("لا صف ثاني للتعبث به");
    await prisma.auditLog.update({
      where: { hash: tamperTarget.hash },
      data: { abstracted_payload: "عبث موثق بعد التعديل" },
    });
  } finally {
    await prisma.$disconnect();
  }
}
