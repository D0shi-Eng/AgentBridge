/**
 * اختبارات قسمَي المصدر المفتوح والأسئلة الشائعة.
 * ملف مستقل عن اختبار الصفحة كي لا تعترض الرقع المتزامنة للصفحة
 * (حد jsdom مع أبناء الخادم غير المتزامنين) استيرادَ القسمين الحقيقيين.
 */

import { describe, it, expect, vi } from "vitest";
import { renderWithLocale } from "@/test/locale-wrapper";
import { OpenSourceSection } from "./OpenSourceSection";
import { FaqSection } from "./FaqSection";

// القسمان خادميان يقرآن كوكي اللغة — نزوّر next/headers
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "ab-locale" ? { value: "ar" } : undefined) }),
}));

describe("قسم المصدر المفتوح", () => {
  it("ثلاث خطط بأسماء عربية معرّبة وحالة صادقة: مجاني / غير متاح بعد / مخطط له", async () => {
    const { container } = renderWithLocale(await OpenSourceSection());
    // أسماء البطاقات معرّبة في الواجهة العربية
    // (المجتمع / السحابة المُدارة / دعم المؤسسات) — الإنجليزية للصفحة الإنجليزية
    expect(container.textContent).toContain("المجتمع");
    expect(container.textContent).toContain("مجاني");
    expect(container.textContent).toContain("السحابة المُدارة");
    expect(container.textContent).toContain("غير متاح بعد");
    expect(container.textContent).toContain("دعم المؤسسات");
    expect(container.textContent).toContain("مخطط له");
    expect(container.textContent).toContain("Apache-2.0");
    expect(container.textContent).not.toContain("Managed Cloud");
    expect(container.textContent).not.toContain("Enterprise Support");
    // لا أزرار بيع — لا خدمة متاحة للشراء اليوم
    expect(container.querySelectorAll("a").length).toBe(0);
    expect(container.querySelector("#open-source")).not.toBeNull();
  });
});

describe("قسم الأسئلة الشائعة", () => {
  it("خمسة أسئلة بإجابات صادقة عن حالة المشروع", async () => {
    const { container } = renderWithLocale(await FaqSection());
    expect(container.textContent).toContain("هل AgentBridge مكتبة أم خدمة؟");
    expect(container.textContent).toContain("ما حالة المشروع؟");
    expect(container.textContent).toContain("ليست متاحة إنتاجيًا بعد");
    expect(container.querySelectorAll("details").length).toBe(5);
  });
});
