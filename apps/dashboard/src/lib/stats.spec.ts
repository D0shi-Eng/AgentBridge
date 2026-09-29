/**
 * اختبارات إحصاءات المستأجر — بطاقات النظرة العامة.
 */
import { describe, expect, it } from "vitest";
import { computeTenantStats } from "./stats.js";

describe("computeTenantStats", () => {
  it("قوائم فارغة = أصفار وnull لا NaN", () => {
    expect(computeTenantStats([], [])).toEqual({
      totalRuns: 0,
      activeRuns: 0,
      grantedCertificates: 0,
      avgFinalScore: null,
      lastRunAt: null,
    });
  });

  it("يحصي الكلي والنشط والممنوح ومتوسط الممنوح فقط", () => {
    const stats = computeTenantStats(
      [
        { status: "completed", createdAt: "2026-08-20T10:00:00Z" },
        { status: "running", createdAt: "2026-08-21T10:00:00Z" },
        { status: "suspended", createdAt: "2026-08-22T10:00:00Z" },
        { status: "failed", createdAt: "2026-08-19T10:00:00Z" },
      ],
      [
        { granted: true, finalScore: 90 },
        { granted: true, finalScore: 96 },
        { granted: false, finalScore: 40 },
      ],
    );
    expect(stats.totalRuns).toBe(4);
    expect(stats.activeRuns).toBe(2);
    expect(stats.grantedCertificates).toBe(2);
    expect(stats.avgFinalScore).toBe(93);
  });

  it("آخر تشغيل بالزمن الأكبر لا بترتيب الوصول", () => {
    const stats = computeTenantStats(
      [
        { status: "completed", createdAt: "2026-08-22T10:00:00Z" },
        { status: "completed", createdAt: "2026-08-25T09:00:00Z" },
      ],
      [],
    );
    expect(stats.lastRunAt).toBe("2026-08-25T09:00:00Z");
  });

  it("شهادات مرفوضة فقط = متوسط null", () => {
    const stats = computeTenantStats([{ status: "completed", createdAt: "2026-08-20T10:00:00Z" }], [
      { granted: false, finalScore: 60 },
    ]);
    expect(stats.grantedCertificates).toBe(0);
    expect(stats.avgFinalScore).toBeNull();
  });
});
