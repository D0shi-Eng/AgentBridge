/** اختبارات تحليلات Flywheel داخل TenantContext موثوق. */
import { describe, expect, it } from "vitest";
import { createInMemoryFlywheelStore } from "./flywheel.js";
import { testContext } from "./test-tenant-context.js";

function item(tenantId: string, pattern: string, score: number, outcome: "success" | "failure", days = 0) {
  return { tenantId, specPattern: pattern, designDecision: pattern, score, outcome, createdAt: new Date(Date.now() - days * 86400000).toISOString() };
}

describe("Flywheel analytics", () => {
  it("يحسب histogram وsuccessRate ويعزل المستأجر", async () => {
    const store = createInMemoryFlywheelStore();
    for (const score of [10, 35, 55, 75, 95]) await store.saveLesson(testContext("a"), item("a", `p${score}`, score, score === 55 || score === 95 ? "failure" : "success"));
    await store.saveLesson(testContext("b"), item("b", "foreign", 100, "success"));
    const result = await store.analytics(testContext("a"), "7d");
    expect(result.totalLessons).toBe(5);
    expect(result.histogram).toEqual([1, 1, 1, 1, 1]);
    expect(result.successRate).toBeCloseTo(0.6);
    // حجم العينة معروض بجانب النسبة: 3 ناجحة من 5 — نسبة بلا حجمها توحي بنتيجة أوسع
    expect(result.successCount).toBe(3);
    expect(result.topPatterns.some((entry) => entry.pattern === "foreign")).toBe(false);
  });

  it("يرتب الأنماط ويطبق cutoff وطول trend", async () => {
    const store = createInMemoryFlywheelStore();
    await store.saveLesson(testContext("a"), item("a", "repeat", 90, "success"));
    await store.saveLesson(testContext("a"), item("a", "repeat", 70, "success"));
    await store.saveLesson(testContext("a"), item("a", "old", 99, "success", 40));
    const seven = await store.analytics(testContext("a"), "7d");
    expect(seven.topPatterns[0]).toMatchObject({ pattern: "repeat", count: 2, avgScore: 80 });
    expect(seven.trend).toHaveLength(7);
    expect((await store.analytics(testContext("a"), "90d")).totalLessons).toBe(3);
  });
});
