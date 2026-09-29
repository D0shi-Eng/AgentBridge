/**
 * اختبارات الصفحة الهبوطية بعد إعادة الكتابة.
 * تجسّر الصفحة كاملة باللغتين عبر كوكي مزوّر، وتقفل أقسام المصدر
 * المفتوح والأسئلة على محتواها الصادق (لا أسعار ولا ادعاء جاهزية).
 */

import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithLocale } from "@/test/locale-wrapper";
import LandingPage from "@/app/(marketing)/page";

// رقعة متزامنة: العرض الفعلي للأقسام مغطى في اختباراته المستقلة أدناه
vi.mock("./OpenSourceSection", () => ({
  OpenSourceSection: () => <section id="open-source" data-testid="open-source-stub" />,
}));
vi.mock("./FaqSection", () => ({
  FaqSection: () => <section id="faq" data-testid="faq-stub" />,
}));

// حالة الكوكي قابلة للتغيير بين الاختبارات — الصفحة خادمية تقرأ كوكي الطلب
const cookieState = vi.hoisted(() => ({ locale: "ar" as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "ab-locale" ? { value: cookieState.locale } : undefined),
  }),
}));

describe("الصفحة الهبوطية — الصياغة المعتمدة", () => {
  it("العربية: العنوان والأزرار والتنبيه وفق النص الملزم", async () => {
    cookieState.locale = "ar";
    const { container } = renderWithLocale(await LandingPage());
    expect(screen.getByText("مفتوح المصدر · مبني لمواصفات OpenAPI · موجّه لفرق المنتجات والمنصات")).toBeInTheDocument();
    expect(container.textContent).toContain("خادم MCP قابل للمراجعة");
    expect(screen.getByText("افتح لوحة التجربة")).toBeInTheDocument();
    expect(screen.getByText("تعرّف إلى آلية العمل")).toBeInTheDocument();
    expect(container.textContent).toContain("النتيجة ليست ضمانًا مطلقًا للأمان");
    expect(container.textContent).toContain("عرض توضيحي ببيانات اصطناعية");
  });

  it("الإنجليزية: مقابل طبيعي للعنوان والأزرار", async () => {
    cookieState.locale = "en";
    const { container } = renderWithLocale(await LandingPage());
    expect(container.textContent).toContain("a reviewable MCP server");
    expect(screen.getByText("Open the demo dashboard")).toBeInTheDocument();
    expect(screen.getByText("See how it works")).toBeInTheDocument();
    expect(container.textContent).toContain("not an absolute security guarantee");
  });

  it("أقسام آلية العمل والأمان بعناوينها الأربع والرقائق التقنية", async () => {
    cookieState.locale = "ar";
    const { container } = renderWithLocale(await LandingPage());
    expect(container.textContent).toContain("من المواصفة إلى خادم MCP في أربع خطوات");
    expect(container.textContent).toContain("أدلة قابلة للفحص، لا ادعاء بالأمان المطلق");
    expect(container.textContent).toContain("سجل تدقيق مترابط بالتجزئة");
    expect(container.textContent).toContain("صفحة عامة للتحقق من النتيجة");
    expect(container.textContent).toContain("MCP tools · HITL");
  });

  it("لا أثر لقسم الأسعار ولا للقصة في الصفحة", async () => {
    cookieState.locale = "ar";
    const { container } = renderWithLocale(await LandingPage());
    expect(container.textContent).not.toContain("$");
    expect(container.textContent).not.toContain("عيادات");
    expect(container.textContent).not.toContain("400–800");
    expect(container.querySelector("#pricing")).toBeNull();
    expect(container.querySelector("#open-source")).not.toBeNull();
  });
});
