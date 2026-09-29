/**
 * اختبارات نمط Result وشجرة الأخطاء.
 *
 * الهدف: التأكد من أن أساس معالجة الفشل في المشروع سليم،
 * فهذه الأنواع تستخدمها كل الحزم الأخرى — عطلها يعني عطل كل شيء.
 */

import { describe, expect, it } from "vitest";
import { AppError, Errors } from "./errors/app-error.js";
import { err, ok } from "./types/result.js";
import {
  SecurityFindingSchema,
  SecurityReportSchema,
  ToolDesignSchema,
} from "./types/artifacts.js";

describe("نمط Result", () => {
  it("ok يغلّف القيمة بنجاح صريح", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("err يغلّف الخطأ بفشل صريح", () => {
    const r = err(new AppError("X", "رسالة"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("X");
      expect(r.error.message).toBe("رسالة");
    }
  });
});

describe("شجرة الأخطاء الموحدة", () => {
  it("خطأ فشل تحليل المواصفة حرج وغير قابل لإعادة المحاولة", () => {
    const e = Errors.specParseFailed("yaml تالف");
    expect(e.severity).toBe("critical");
    expect(e.retryable).toBe(false);
  });

  it("خطأ خرج النموذج قابل لإعادة المحاولة لأن الإصلاح ممكن", () => {
    const e = Errors.llmOutputInvalid("designer");
    expect(e.retryable).toBe(true);
  });

  it("النتيجة الأمنية الحرجة ترفض الشهادة نهائياً", () => {
    const e = Errors.securityCritical("SEC-001");
    expect(e.retryable).toBe(false);
    expect(e.message).toContain("SEC-001");
  });
});

describe("مخططات التقرير الأمني", () => {
  it("نتيجة أمنية بشرح تفصيلي تُقبل وبدونه أيضاً", () => {
    const withDetail = SecurityFindingSchema.safeParse({
      id: "HB-01",
      severity: "critical",
      title: "استدعاء eval",
      location: "src/tools.ts",
      detail: "نمط eval( مكتشف في السطر 12",
    });
    const withoutDetail = SecurityFindingSchema.safeParse({
      id: "HB-02",
      severity: "info",
      title: "ملاحظة",
    });
    expect(withDetail.success).toBe(true);
    expect(withoutDetail.success).toBe(true);
  });

  it("تقرير تحصين مكتمل يمر بالمخطط الصارم", () => {
    const parsed = SecurityReportSchema.safeParse({
      findings: [
        { id: "HB-05", severity: "high", title: "سر مضمّن", detail: "قيمة حرفية" },
      ],
      totalChecks: 12,
      passedCount: 11,
      hasCritical: false,
      cleanlinessScore: 75,
    });
    expect(parsed.success).toBe(true);
  });

  it("تقرير بحقول زائدة يُرفض (strict)", () => {
    const parsed = SecurityReportSchema.safeParse({
      findings: [],
      totalChecks: 0,
      passedCount: 0,
      hasCritical: false,
      cleanlinessScore: 100,
      extra: true,
    });
    expect(parsed.success).toBe(false);
  });

  it("درجة نظافة خارج المدى 0–100 تُرفض", () => {
    const parsed = SecurityReportSchema.safeParse({
      findings: [],
      totalChecks: 3,
      passedCount: 3,
      hasCritical: false,
      cleanlinessScore: 101,
    });
    expect(parsed.success).toBe(false);
  });

  it("تصميم أداة سليم لا يزال يجتاز مخططه بعد توسعة shared", () => {
    const parsed = ToolDesignSchema.safeParse({
      name: "list_pets",
      description: "List all pets in the store.",
      endpointIds: ["listPets"],
      parameters: {},
    });
    expect(parsed.success).toBe(true);
  });
});
