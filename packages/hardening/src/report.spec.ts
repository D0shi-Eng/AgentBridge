/**
 * اختبارات التجميع والدرجة — عقد الدرجة الموثق في report.ts:
 * حرجة واحدة = صفر، وإلا خصم 25/10/3 بحد أدنى صفر.
 */

import { describe, expect, it } from "vitest";
import {
  buildSecurityReport,
  computeCleanlinessScore,
  type SecurityCheckResult,
} from "./report.js";

function check(overrides: Partial<SecurityCheckResult>): SecurityCheckResult {
  return {
    id: "HB-00",
    title: "فحص اختبار",
    category: "dangerous-code",
    severityIfFailed: "medium",
    passed: true,
    ...overrides,
  };
}

describe("computeCleanlinessScore", () => {
  it("كل الفحوص ناجحة = 100", () => {
    expect(computeCleanlinessScore([check({}), check({ id: "HB-02" })])).toBe(100);
  });

  it("نتيجة حرجة واحدة تسقط الدرجة إلى صفر مهما كانت البقية", () => {
    const results = [check({}), check({ id: "HB-05", severityIfFailed: "critical", passed: false })];
    expect(computeCleanlinessScore(results)).toBe(0);
  });

  it("الخصم يجمع بحسب الخطورة: high+medium = 65", () => {
    const results = [
      check({ id: "A", severityIfFailed: "high", passed: false }),
      check({ id: "B", severityIfFailed: "medium", passed: false }),
    ];
    expect(computeCleanlinessScore(results)).toBe(65);
  });

  it("الأرضية صفر — لا درجات سالبة مع تراكم الفشل", () => {
    const results = Array.from({ length: 6 }, (_, i) =>
      check({ id: `X${i}`, severityIfFailed: "high", passed: false }),
    );
    expect(computeCleanlinessScore(results)).toBe(0);
  });
});

describe("buildSecurityReport — بناء التقرير", () => {
  it("الفحوص الناجحة لا تنتج نتائج، والإحصاءات صحيحة", () => {
    const results = [
      check({ id: "HB-01" }),
      check({ id: "HB-02" }),
    ];
    const report = buildSecurityReport(results);
    expect(report.findings).toHaveLength(0);
    expect(report.totalChecks).toBe(2);
    expect(report.passedCount).toBe(2);
    expect(report.hasCritical).toBe(false);
    expect(report.cleanlinessScore).toBe(100);
  });

  it("الفاشلة تتحول إلى SecurityFinding بكل تفاصيلها وترفع hasCritical", () => {
    const results = [
      check({ id: "HB-01", passed: false, location: "src/tools.ts:12", detail: "eval مكتشف" }),
      check({ id: "HD-01", category: "live", severityIfFailed: "critical", passed: false, title: "تسريب" }),
      check({ id: "HB-09", passed: true }),
    ];
    const report = buildSecurityReport(results);
    expect(report.totalChecks).toBe(3);
    expect(report.passedCount).toBe(1);
    expect(report.findings.map((f) => f.id).sort()).toEqual(["HB-01", "HD-01"]);
    expect(report.hasCritical).toBe(true);
    expect(report.cleanlinessScore).toBe(0);

    const first = report.findings.find((f) => f.id === "HB-01");
    expect(first?.location).toBe("src/tools.ts:12");
    expect(first?.detail).toContain("eval");
    expect(first?.severity).toBe("medium");
  });
});
