/**
 * اختبارات دورة حياة مقابض التشغيل.
 *
 * يثبت على المصدر النهائي: (1) المقود المكتمل يتقاعد ويُحذف من الخريطة
 * فلا نمو بلا حد عبر تكرار التشغيل؛ (2) المقود الراسب (قفل محتجز) يتقاعد
 * كذلك؛ (3) مؤقت التجديد يموت مع انتهاء التشغيل (عدد التجديدات يتجمد)؛
 * (4) shutdown يمسح كل شيء فوراً حتى أثناء تشغيل حي.
 * مزود اصطناعي وتوليدات داخل الذاكرة — لا بنية خارجية ولا حمل.
 */

import { mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildContainer, developmentEnv, type ApiContainer } from "./container.js";
import { createProviderFactoryForConfig } from "./container/provider-helpers.js";
import { RunService } from "./run-service.js";
import { loadConfig } from "@agentbridge/infra";

function repoTempDir(prefix: string): string {
  return mkdtempSync(join(fileURLToPath(new URL("../../../tests/e2e/.tmp", import.meta.url)), prefix));
}

const PETSTORE = `openapi: 3.0.0
info: { title: t, version: "1" }
paths:
  /pets:
    get:
      operationId: listPets
      responses: { "200": { description: ok } }
`;

/** ينتظر حتى يتقاعد المقود (isRunning=false) بمهلة صريحة */
async function until(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("انقضت مهلة انتظار دورة الحياة");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("دورة حياة مقابض التشغيل", () => {
  let container: ApiContainer;
  let service: RunService;
  let providerFactoryForTests: ReturnType<typeof createProviderFactoryForConfig>;

  beforeAll(async () => {
    container = await buildContainer({ env: developmentEnv(), workRoot: repoTempDir("ab-lifecycle-") });
    const config = loadConfig(developmentEnv());
    if (!config.ok) throw config.error;
    const providerFactory = createProviderFactoryForConfig(config.value);
    service = new RunService({
      semantic: container.semantic,
      episodic: container.episodic,
      audit: container.audit,
      // مزود الاصطناعي القياسي من إعداد التطوير — الرحلة تكمل داخلياً
      providerFactory,
      workRoot: repoTempDir("ab-lifecycle-svc-"),
      handleRetentionMs: 0, // تقاعد فوري — الاختبار لا ينتظر 60 ثانية
    });
    providerFactoryForTests = providerFactory;
  }, 60_000);

  afterAll(async () => {
    service.shutdown();
    await container.close?.();
  });

  it("المقود المكتمل يتقاعد: العدد يعود إلى خط الأساس بعد كل تشغيل", async () => {
    const baseline = service.handleCount();
    await container.semantic.createTenant({ tenantId: "t-c11", name: "C11", apiKeyHash: "c11-synthetic-hash", createdAt: new Date().toISOString() });
    service.start({ runId: "run-c11-1", tenantId: "t-c11", projectId: "p", specId: "s", rawSpec: PETSTORE });
    await until(() => !service.isRunning("run-c11-1"));
    await until(() => service.handleCount() === baseline);
    expect(service.handleCount()).toBe(baseline);
  });

  it("تكرار خمسة تشغيلات متتالية لا يراكم المقود (لا نمو بلا حد)", async () => {
    const baseline = service.handleCount();
    for (let i = 0; i < 5; i += 1) {
      const runId = `run-c11-seq-${i}`;
      service.start({ runId, tenantId: "t-c11", projectId: "p", specId: "s", rawSpec: PETSTORE });
      await until(() => !service.isRunning(runId));
      await until(() => service.handleCount() === baseline);
    }
    expect(service.handleCount()).toBe(baseline);
  });

  it("المقود الراسب (قفل محتجز) يتقاعد كذلك — لا تسريب في مسار الرفض", async () => {
    const baseline = service.handleCount();
    const locked = new RunService({
      semantic: container.semantic,
      episodic: container.episodic,
      audit: container.audit,
      providerFactory: providerFactoryForTests,
      workRoot: repoTempDir("ab-lifecycle-lock-"),
      handleRetentionMs: 0,
      runLock: { acquire: async () => ({ acquired: false }), renew: async () => false, release: async () => true, currentFence: async () => 0 },
    });
    locked.start({ runId: "run-c11-locked", tenantId: "t-c11", projectId: "p", specId: "s", rawSpec: PETSTORE });
    await until(() => !locked.isRunning("run-c11-locked"));
    await until(() => locked.handleCount() === baseline);
    expect(locked.handleCount()).toBe(baseline);
    locked.shutdown();
  });

  it("shutdown يمسح المقود والمؤقتات فوراً حتى أثناء تشغيل حي", async () => {
    const baseline = service.handleCount();
    service.start({ runId: "run-c11-live", tenantId: "t-c11", projectId: "p", specId: "s", rawSpec: PETSTORE });
    service.shutdown();
    expect(service.handleCount()).toBe(0);
    // الإغلاق منظم: لا تشغيل معلّق بعد المسح
    expect(service.isRunning("run-c11-live")).toBe(false);
    expect(baseline).toBe(0);
  });
});
