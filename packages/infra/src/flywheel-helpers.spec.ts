/** يثبت أن التحليلات والتضمين المحلي حتميان ولا يتجاوزان حدود المستأجر. */
import { describe, expect, it } from "vitest";
import { computeFlywheelAnalytics, embedLessonDeterministic, rangeToDays } from "./flywheel-helpers.js";

const NOW = new Date("2026-09-06T12:00:00.000Z");

describe("flywheel-helpers", () => {
  it.each([["7d", 7], ["30d", 30], ["90d", 90]] as const)("يحول %s إلى عدد الأيام", (range, days) => {
    expect(rangeToDays(range)).toBe(days);
  });

  it("يحسب المتوسط والنمط والمدرج والاتجاه", () => {
    const lessons = [
      { specPattern: "clinic", designDecision: "a", outcome: "success" as const, score: 90, tenantId: "t1", createdAt: "2026-09-06T01:00:00.000Z" },
      { specPattern: "clinic", designDecision: "b", outcome: "failure" as const, score: 50, tenantId: "t1", createdAt: "2026-09-05T01:00:00.000Z" },
      { specPattern: "school", designDecision: "c", outcome: "success" as const, score: 10, tenantId: "t1", createdAt: "2026-09-04T01:00:00.000Z" },
    ];
    const result = computeFlywheelAnalytics(lessons, "7d", NOW);
    expect(result).toMatchObject({ totalLessons: 3, avgScore: 50, successRate: 0.6667 });
    expect(result.histogram).toEqual([1, 0, 1, 0, 1]);
    expect(result.topPatterns[0]).toEqual({ pattern: "clinic", count: 2, avgScore: 70 });
    expect(result.trend).toHaveLength(7);
    expect(result.trend.at(-1)).toEqual({ date: "2026-09-06", count: 1 });
  });

  it("يعيد نتيجة فراغ سليمة", () => {
    expect(computeFlywheelAnalytics([], "7d", NOW)).toMatchObject({ totalLessons: 0, avgScore: 0, successRate: 0 });
  });

  it("ينتج متجهاً حتمياً مطبعاً ولا يكشف النص", () => {
    const first = embedLessonDeterministic("عيادة clinic success");
    expect(first).toHaveLength(1536);
    expect(embedLessonDeterministic("عيادة clinic success")).toEqual(first);
    expect(Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1);
    expect(embedLessonDeterministic("!!!").every((value) => value === 0)).toBe(true);
  });
});
