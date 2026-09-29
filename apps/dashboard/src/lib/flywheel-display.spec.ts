/**
 * اختبارات مفسّر عرض القرار — تفكيك الصيغة الموثقة دون تغيير المعنى.
 */

import { describe, expect, it } from "vitest";
import { lessonDecisionView } from "./flywheel-display.js";

describe("lessonDecisionView", () => {
  it("يفك صيغة الشهادة الموثقة tools:<score>:AB-… إلى تسمية عربية", () => {
    const view = lessonDecisionView("tools:96:AB-c9f9ab0f", "ar");
    expect(view.kind).toBe("cert");
    expect(view.label).toContain("96");
    expect(view.label).toContain("AB-c9f9ab0f");
    expect(view.raw).toBe("tools:96:AB-c9f9ab0f");
  });

  it("يفك صيغة الحالة المعروفة status:completed", () => {
    const view = lessonDecisionView("status:completed", "ar");
    expect(view.kind).toBe("status");
    expect(view.label).toContain("مكتمل");
  });

  it("الصيغة الغامضة تُعرض كما هي — لا اختلاق وصف", () => {
    const view = lessonDecisionView("قرار نصي حر من مستقبل", "ar");
    expect(view.kind).toBe("raw");
    expect(view.label).toBe("قرار نصي حر من مستقبل");
  });

  it("tools بدرجة خارج 0-100 لا تُقبل كصيغة شهادة", () => {
    const view = lessonDecisionView("tools:999:AB-x", "ar");
    expect(view.kind).toBe("raw");
  });

  it("الإنجليزية تحصل على المقابل الإنجليزي", () => {
    const cert = lessonDecisionView("tools:85:AB-12345678", "en");
    expect(cert.label).toContain("85");
    const status = lessonDecisionView("status:failed", "en");
    expect(status.label).toContain("Failed");
  });
});
