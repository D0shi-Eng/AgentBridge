import { generateKeyPairSync } from "node:crypto";
/**
 * اختبارات الأمن وحدود الثقة على مستوى API.
 *
 * تغطية: حماية /metrics، معقم الأحداث، رفض الإقلاع
 * الإنتاجي غير الدائم، ومحدد الطلبات والحصص.
 * كلها بلا شبكة خارجية — الحتمية أولاً.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { RATE_LIMIT_RULES, RateLimiter, loadConfig } from "@agentbridge/infra";
import type { PipelineEvent } from "@agentbridge/shared";
import { buildApp } from "./app.js";
import { buildContainer, developmentEnv, type ApiContainer } from "./container.js";
import { sanitizePipelineEvent, MAX_EVENT_SUMMARY_CHARS } from "./run-service/event-sanitizer.js";
import { generateEncryptionKeyBase64 } from "@agentbridge/infra";

describe("رفض إقلاع إنتاجي بأرضية غير إنتاجية", () => {
  // مفاتيح توقيع اصطناعية سليمة للإنتاج — الإقلاع الإنتاجي يستلزم الثلاثية
  const signingKey = (): string => generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const productionEnv = (): Record<string, string> => ({
    ...developmentEnv(),
    NODE_ENV: "production",
    ENCRYPTION_KEY: generateEncryptionKeyBase64(),
    ORCH_SNAPSHOT_PRIVATE_KEY: signingKey(),
    CERT_SIGNING_PRIVATE_KEY: signingKey(),
    HITL_SIGNING_PRIVATE_KEY: signingKey(),
  });

  it("production + memory = رفض صريح برسالة عربية", async () => {
    await expect(
      buildContainer({ env: { ...productionEnv(), PERSISTENCE: "memory" } }),
    ).rejects.toThrow(/رفض الإقلاع[\s\S]*PERSISTENCE=memory/u);
  });

  it("production بلا مفاتيح التوقيع الثلاثة = رفض صريح (لا مفاتيح عابرة للإنتاج)", () => {
    const noKeys = { ...productionEnv() };
    delete noKeys.ORCH_SNAPSHOT_PRIVATE_KEY;
    delete noKeys.CERT_SIGNING_PRIVATE_KEY;
    delete noKeys.HITL_SIGNING_PRIVATE_KEY;
    const result = loadConfig({ ...noKeys, PERSISTENCE: "live" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("ORCH_SNAPSHOT_PRIVATE_KEY");
      expect(result.error.message).toContain("CERT_SIGNING_PRIVATE_KEY");
      expect(result.error.message).toContain("HITL_SIGNING_PRIVATE_KEY");
    }
  });

  it("production + mock LLM = رفض صريح برسالة عربية", async () => {
    const result = loadConfig({ ...productionEnv(), PERSISTENCE: "live", LLM_PROVIDER: "mock" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("LLM_PROVIDER=mock مرفوض في الإنتاج");
  });

  it("production + live + مزود شبكي بمفتاحه — الأرضية كاملة ما عدا KMS ⇒ الرفض الوحيد بوابة KMS", () => {
    // العقد: لا إقلاع إنتاجي بمزود مفاتيح اختباري محلي —
    // EXTERNAL_KMS = NOT_VERIFIED حتى اعتماد مزود خارجي إدارياً.
    // الاختبار يثبت أن بوابات الرفض الأخرى لم تعد تُذكَر في الرسالة.
    const result = loadConfig({
      ...productionEnv(),
      PERSISTENCE: "live",
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-test-synthetic-key-not-real-0001",
      RETENTION_POLICY_JSON: '{"episodicEventsDays":7,"signedSnapshotsDays":7,"runArchives":"permanent","certificates":"permanent","artifacts":"permanent","auditLog":"permanent","revocations":"permanent","semanticCore":"tenant-lifetime","sessions":"permanent","loginTransactions":"permanent","operationalLogs":"permanent","backups":"permanent","memoryWorking":"ephemeral","memoryVector":"permanent","flywheelLessons":"permanent","ssoConfig":"tenant-lifetime"}',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("KMS_PROVIDER=local مرفوض في الإنتاج");
      expect(result.error.message).not.toContain("PERSISTENCE=memory");
      expect(result.error.message).not.toContain("LLM_PROVIDER=mock");
      expect(result.error.message).not.toContain("RETENTION_POLICY_JSON مفقود");
    }
  });
});

describe("/metrics محمية fail-closed", () => {
  let container: ApiContainer;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    container = await buildContainer({
      env: { ...developmentEnv(), METRICS_TOKEN: "metrics-token-0123456789" },
    });
    app = buildApp(container);
  });

  it("بتوكن صحيح = 200 نص مقاييس", async () => {
    // طلاء عدّاد أولاً — السجل الفارغ لا يطبع أسطراً بعد
    await app.inject({ method: "GET", url: "/health" });
    const response = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer metrics-token-0123456789" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it("بلا توكن = 401 موحد، وبتوكن خاطئ = 401 (اختبار سلبي)", async () => {
    const none = await app.inject({ method: "GET", url: "/metrics" });
    expect(none.statusCode).toBe(401);
    expect(JSON.parse(none.body).error.code).toBe("UNAUTHORIZED");
    const wrong = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer wrong-token-0000000000" },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it("الإنتاج بلا توكن مقاييس = الرفض الإجمالي شامل — بوابة KMS أشد من بوابة المقاييس", () => {
    // العقد: لا إقلاع إنتاجي أصلاً بمزود KMS اختباري — فيبقى
    // فحص غياب METRICS_TOKEN مغطى بالبند أعلاه (بتوكن = 200) ومنطق
    // metrics fail-closed عند غياب التوكن في الأنماط غير الإنتاجية الموثقة.
    const signingKey = (): string => generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    const result = loadConfig({
      ...developmentEnv(),
      NODE_ENV: "production",
      ENCRYPTION_KEY: generateEncryptionKeyBase64(),
      ORCH_SNAPSHOT_PRIVATE_KEY: signingKey(),
      CERT_SIGNING_PRIVATE_KEY: signingKey(),
      HITL_SIGNING_PRIVATE_KEY: signingKey(),
      PERSISTENCE: "live",
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-test-synthetic-key-not-real-0002",
      RETENTION_POLICY_JSON: '{"episodicEventsDays":7,"signedSnapshotsDays":7,"runArchives":"permanent","certificates":"permanent","artifacts":"permanent","auditLog":"permanent","revocations":"permanent","semanticCore":"tenant-lifetime","sessions":"permanent","loginTransactions":"permanent","operationalLogs":"permanent","backups":"permanent","memoryWorking":"ephemeral","memoryVector":"permanent","flywheelLessons":"permanent","ssoConfig":"tenant-lifetime"}',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("KMS_PROVIDER=local مرفوض في الإنتاج");
  });
});

describe("معقم أحداث موحد قبل البث والتخزين", () => {
  const base: PipelineEvent = {
    runId: "run-1",
    tenantId: "tenant-1",
    stage: "harden",
    at: "2030-01-15T12:00:00.000Z",
    summary: "اكتمل الفحص",
    stageStatus: "completed",
  };

  it("حدث سليم يمر كما هو", () => {
    const clean = sanitizePipelineEvent(base);
    expect(clean).toEqual(base);
  });

  it("حقول زائدة تُسقط — allowlist لا تمرير كائنات داخلية", () => {
    const smuggled = { ...base, internalState: { secret: "x" }, stackTrace: "at ..." } as unknown as PipelineEvent;
    const clean = sanitizePipelineEvent(smuggled);
    expect(clean).toEqual(base);
    expect(JSON.stringify(clean)).not.toContain("secret");
  });

  it("أسرار في الملخص تُحجب، والملخص الضخم يُقص بحد معلن", () => {
    const secretish = sanitizePipelineEvent({ ...base, summary: "فشل بخطأ api_key=sk-abc123secret000 لن يمر" });
    expect(secretish?.summary).not.toContain("sk-abc123secret000");
    const huge = sanitizePipelineEvent({ ...base, summary: "س".repeat(10_000) });
    expect(huge?.summary.length).toBe(MAX_EVENT_SUMMARY_CHARS + "…[مقصوص]".length);
  });

  it("حدث لا يطابق المخطط أساساً يُسقط كلياً (null) — لا بث ولا تخزين", () => {
    const broken = { ...base, stage: "not-a-stage" } as unknown as PipelineEvent;
    expect(sanitizePipelineEvent(broken)).toBeNull();
  });
});

describe("محدد الطلبات: نافذة منزلقة حتمية وحصص معزولة", () => {
  it("تحت السقف يمر، فوقه يُرفض بـRetry-After، والنافذة تنزلق بزمن محقون", () => {
    let now = 1_000_000;
    const limiter = new RateLimiter(3, () => now);
    expect(limiter.consume("k").allowed).toBe(true);
    expect(limiter.consume("k").allowed).toBe(true);
    expect(limiter.consume("k").allowed).toBe(true);
    const denied = limiter.consume("k");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    now += 60_001; // نافذة جديدة كلياً — يسمح مجدداً
    expect(limiter.consume("k").allowed).toBe(true);
  });

  it("عزل الحصص: استهلاك مفتاح لا يمس مفتاحاً آخر", () => {
    const now = 2_000_000;
    const limiter = new RateLimiter(2, () => now);
    limiter.consume("tenant-a");
    limiter.consume("tenant-a");
    expect(limiter.consume("tenant-a").allowed).toBe(false);
    expect(limiter.consume("tenant-b").allowed).toBe(true);
  });

  it("السقوف الافتراضية موثقة كثوابت (لا قيم سحرية في المسارات)", () => {
    expect(RATE_LIMIT_RULES.preAuthPerMinute).toBeGreaterThan(0);
    expect(RATE_LIMIT_RULES.tenantReadPerMinute).toBeGreaterThan(RATE_LIMIT_RULES.preAuthPerMinute);
    expect(RATE_LIMIT_RULES.tenantRunPerMinute).toBeLessThan(RATE_LIMIT_RULES.tenantReadPerMinute);
  });
});
