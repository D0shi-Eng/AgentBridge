/**
 * اختبارات المحدد الموزع فوق Redis بلا Redis:
 * سياسات التعطل المعلنة (fail-closed/fail-open) وقرار الرفض — عبر
 * مزدوج أوامر يرمي أو يعيد ردود Lua مصطنعة. ذرية النافذة الحقيقية
 * تُختبر حياً ضد Redis فعلي (مشروطة بيئياً).
 */

import { describe, expect, it } from "vitest";
import { createRedisRateLimiter } from "@agentbridge/infra";

const BASE = { keyPrefix: "rl:test", limit: 3, windowMs: 60_000 } as const;

describe("سياسة تعطل مخزن الحصص", () => {
  it("fail-closed يرفض عند تعطل Redis بقرار 503--style (Retry-After) — لا تجاوز صامت", async () => {
    const limiter = createRedisRateLimiter(
      { eval: async () => { throw new Error(" connection refused"); } },
      { ...BASE, outagePolicy: "fail-closed" },
    );
    const decision = await limiter.consume("ip:1.2.3.4");
    expect(decision.allowed).toBe(false);
    expect(decision.count).toBe(-1); // علامة تعطل المخزن — يميز الرفض 503 عن 429
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("fail-open للتطوير المحلي فقط — قرار معلن عند البناء لا عند الحدث", async () => {
    const limiter = createRedisRateLimiter(
      { eval: async () => { throw new Error("connection refused"); } },
      { ...BASE, outagePolicy: "fail-open" },
    );
    expect((await limiter.consume("ip:1.2.3.4")).allowed).toBe(true);
  });
});

describe("قرارات النافذة من ردود Lua", () => {
  it("السماح يمر والرفض يحسب Retry-After من أقدم عضو في النافذة", async () => {
    const replies: unknown[] = [
      ["1", "0", "1"], // مسموح
      ["0", String(Date.now() - 10_000), "3"], // مرفوض — أقدم عضو قبل 10 ثوانٍ
    ];
    let call = 0;
    const limiter = createRedisRateLimiter(
      { eval: async () => replies[call++] },
      { ...BASE, outagePolicy: "fail-closed" },
    );
    const allowed = await limiter.consume("t:a");
    expect(allowed.allowed).toBe(true);
    expect(allowed.count).toBe(1);

    const rejected = await limiter.consume("t:a");
    expect(rejected.allowed).toBe(false);
    // 60 ثانية نافذة − 10 مرت على أقدمها → Retry-After ≈ 50 (±1 للتقريب الزمني)
    expect(rejected.retryAfterSeconds).toBeGreaterThanOrEqual(49);
    expect(rejected.retryAfterSeconds).toBeLessThanOrEqual(51);
  });
});
