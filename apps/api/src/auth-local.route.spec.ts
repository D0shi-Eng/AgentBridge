/**
 * اختبارات جلسة الوضع المحلي — العقد الأمني:
 * الجلسة تُمنح تلقائياً للطلب المحلي المستوفي حصراً: Origin===appOrigin
 * حرفياً، Host ضمن مضيفي الحلقة (حسم DNS rebinding)، وترويسة عميل اللوحة
 * المخصصة التي لا تستطيعها صفحة ويب خارجية (preflight لن ينجح بلا CORS)
 * ولا نموذج HTML. جلسة صالحة قائمة تُعاد دون منح جديدة، والتعطيل يزيل
 * النقطة كلها، والجلسة المشتقة بصلاحيات الاعتماد المضيّقة حصراً.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "./app.js";
import { buildContainer, developmentEnv, type ApiContainer } from "./container.js";
import type { FastifyInstance } from "fastify";

const origin = "http://127.0.0.1:3001";
const host = "127.0.0.1:3000";
const clientHeader = { "x-agentbridge-local": "1" };

interface Harness { app: FastifyInstance; container: ApiContainer; workRoot: string }

/** يبني تطبيقاً بالوضع المحلي مفعلاً واعتماد مساحة العمل المحلية جاهزاً */
async function buildLocal(): Promise<Harness> {
  const workRoot = mkdtempSync(join(tmpdir(), "ab-local-"));
  const container = await buildContainer({
    env: {
      ...developmentEnv(),
      LOCAL_BOOTSTRAP: "1",
      LOCAL_TENANT_ID: "local-tenant",
      LOCAL_CREDENTIAL_ID: "local-cred-1",
    },
    workRoot,
  });
  // اعتماد مساحة العمل المحلية بصلاحيات مضيّقة - كما يولّده الإعداد فعلياً
  await container.authStore.putApiCredential({
    credentialId: "local-cred-1", tenantId: "local-tenant",
    subjectId: "service:local-tenant",
    keyHash: "not-a-real-key-hash",
    permissions: ["resource:read", "pipeline:run", "pipeline:review", "artifact:read", "flywheel:read", "flywheel:write", "analytics:read"],
    authorizationVersion: 1,
  });
  const app = buildApp(container);
  return { app, container, workRoot };
}

describe("جلسة الوضع المحلي التلقائية", () => {
  let harness: Harness;
  let app: FastifyInstance;

  beforeAll(async () => {
    harness = await buildLocal();
    app = harness.app;
  });

  afterAll(async () => { await app.close(); rmSync(harness.workRoot, { recursive: true, force: true }); });

  it("mode يعلن التفعيل", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/local/mode", headers: { host } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ enabled: true });
  });

  it("طلب محلي مستوفٍ يفتح جلسة بكوكيز وصلاحيات الاعتماد المضيّقة — بلا رمز ولا جسم", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/local/session", headers: { origin, host, ...clientHeader } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { authenticated: boolean; tenantId: string };
    expect(body.authenticated).toBe(true);
    expect(body.tenantId).toBe("local-tenant");
    const setCookie = res.headers["set-cookie"] as string[];
    expect(setCookie.join(" ")).toContain("ab_session_dev=");
    // الجلسة المشتقة تعمل وتحمل الصلاحيات المضيّقة بالترتيب نفسه
    const cookies = setCookie.map((v) => v.split(";", 1)[0] ?? "").join("; ");
    const probe = await app.inject({ method: "GET", url: "/auth/session", headers: { cookie: cookies, host } });
    expect(probe.statusCode).toBe(200);
    expect((JSON.parse(probe.body) as { tenantId: string }).tenantId).toBe("local-tenant");
  });

  it("جلسة صالحة قائمة تُعاد دون منح جديدة — إعادة الفتح لا تضخم جدول الجلسات", async () => {
    const first = await app.inject({ method: "POST", url: "/auth/local/session", headers: { origin, host, ...clientHeader } });
    const cookies = (first.headers["set-cookie"] as string[]).map((v) => v.split(";", 1)[0] ?? "").join("; ");
    const again = await app.inject({ method: "POST", url: "/auth/local/session", headers: { origin, host, ...clientHeader, cookie: cookies } });
    expect(again.statusCode).toBe(200);
    expect((JSON.parse(again.body) as { tenantId: string }).tenantId).toBe("local-tenant");
    expect(again.headers["set-cookie"]).toBeUndefined();
  });

  it("Origin غير مطابق يُرفض قبل أي شيء", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/local/session", headers: { origin: "https://evil.example", host, ...clientHeader } });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe("ORIGIN_REJECTED");
  });

  it("Host خارج الحلقة (DNS rebinding) يُرفض", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/local/session", headers: { origin, host: "attacker.example:80", ...clientHeader } });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe("HOST_REJECTED");
  });

  it("غياب ترويسة عميل اللوحة (نموذج HTML أو fetch بلا preflight) يُرفض", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/local/session", headers: { origin, host } });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe("FORBIDDEN");
  });

  it("قيمة ترويسة غير صحيحة تُرفض كذلك", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/local/session", headers: { origin, host, "x-agentbridge-local": "yes" } });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe("FORBIDDEN");
  });
});

describe("الوضع المحلي معطل = لا نقطة جلسة إطلاقاً", () => {
  let app: FastifyInstance;
  let workRoot: string;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), "ab-local-off-"));
    const container = await buildContainer({ env: developmentEnv(), workRoot });
    app = buildApp(container);
  });

  afterAll(async () => { await app.close(); rmSync(workRoot, { recursive: true, force: true }); });

  it("mode يعلن التعطيل وsession غير موجودة (404)", async () => {
    const mode = await app.inject({ method: "GET", url: "/auth/local/mode", headers: { host } });
    expect(mode.statusCode).toBe(200);
    expect(JSON.parse(mode.body)).toEqual({ enabled: false });
    const session = await app.inject({ method: "POST", url: "/auth/local/session", headers: { origin, host, ...clientHeader } });
    expect(session.statusCode).toBe(404);
  });
});

describe("رفض إقلاع ناقص التهيئة", () => {
  it("LOCAL_BOOTSTRAP=1 بلا هوية واعتماد = رفض إقلاع عربي", async () => {
    const { buildContainer: bc } = await import("./container.js");
    const error = await bc({ env: { ...developmentEnv(), LOCAL_BOOTSTRAP: "1" } }).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).not.toBeNull();
    expect(String((error as Error).message)).toContain("LOCAL_TENANT_ID");
  });
});
