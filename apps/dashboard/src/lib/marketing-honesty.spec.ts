/**
 * اختبار صدق التسويق.
 * يحمي الصياغة الصادقة المعتمدة من الارتداد: لا أسعار لخدمة غير متاحة،
 * لا أرقام مدّعية، لا قصة مختلقة، لا وعد استضافة/SLA، ولا إنجليزية داخل
 * النص العربي خارج قائمة المصطلحات التقنية المسموحة المحصورة بـ bdi.
 */

import { describe, expect, it } from "vitest";
import { ar } from "@/lib/i18n/ar.js";
import { en } from "@/lib/i18n/en.js";

const MARKETING_AR = Object.entries(ar).filter(([key]) => key.startsWith("marketing.") || key.startsWith("demo."));
const MARKETING_EN = Object.entries(en).filter(([key]) => key.startsWith("marketing.") || key.startsWith("demo."));

/** عبارات ممنوعة نهائيًا في نصوص التسويق باللغتين */
const BANNED = [
  "400–800",
  "600 ساعة",
  "600 hours",
  "$149",
  "$449",
  "$",
  "بمئات الآلاف",
  "غير محدود",
  "مدير نجاح عملاء",
  "customer success manager",
  "هجوم",
  "هجمات",
  "On-prem",
  "on-prem",
  "OnPrem",
  "SLA",
  "unlimited",
  "Unlimited",
  "attack",
  "Attack",
];

/** المصطلحات التقنية المسموحة داخل النص العربي — تُحصر بـ bdi عند العرض */
const ALLOWED_LATIN = [
  "upload-spec.yaml",
  "static + live checks",
  "search_appointments",
  "create_patient_note",
  "Managed Cloud",
  "Enterprise Support",
  "MCP tools",
  "Apache-2.0",
  "AgentBridge",
  "/verify",
  "OpenAPI",
  "Community",
  "3.x",
  "MCP",
  "API",
  "YAML",
  "JSON",
  "HITL",
  "ZIP",
  "KB",
  "AB-…",
  "HB",
  "HD",
  "sandbox",
];

describe("صدق نصوص التسويق", () => {
  it("لا عبارة ممنوعة في القاموسين", () => {
    for (const [key, value] of [...MARKETING_AR, ...MARKETING_EN]) {
      for (const phrase of BANNED) {
        expect(value, `المفتاح ${key} يحوي عبارة ممنوعة: ${phrase}`).not.toContain(phrase);
      }
    }
  });

  it("«آمن بالكامل» لا تظهر إلا في سؤال FAQ الملزم الذي تنفيه الإجابة", () => {
    const hits = MARKETING_AR.filter(([, value]) => value.includes("آمن بالكامل"));
    expect(hits.map(([key]) => key)).toEqual(["marketing.faq3q"]);
    // المقابل الإنجليزي الطبيعي لسؤال النفي نفسه — لا استخدام إيجابي في بقية المفاتيح
    const enHits = MARKETING_EN.filter(([, value]) => value.includes("fully secure"));
    expect(enHits.map(([key]) => key)).toEqual(["marketing.faq3q"]);
  });

  it("لا حروف لاتينية في العربية خارج قائمة المصطلحات المسموحة", () => {
    for (const [key, value] of MARKETING_AR) {
      let stripped: string = value;
      for (const term of [...ALLOWED_LATIN].sort((a, b) => b.length - a.length)) {
        stripped = stripped.split(term).join("▮");
      }
      const latin = stripped.match(/[A-Za-z]/g) ?? [];
      expect(latin, `المفتاح ${key} يحوي لاتينية غير مسموحة بعد الاستبعاد: ${stripped}`).toHaveLength(0);
    }
  });

  it("مفاتيح القصة والأسعار القديمة محذوفة نهائيًا", () => {
    const removed = [
      "marketing.problemKicker",
      "marketing.storyQuote",
      "marketing.storyAttribution",
      "marketing.hoursNumber",
      "marketing.zeroNumber",
      "marketing.securityChecksNote",
      "marketing.pricingKicker",
      "marketing.planStarter",
      "marketing.planGrowth",
      "marketing.planEnterprise",
      "marketing.priceStarter",
      "marketing.priceGrowth",
      "marketing.pricingContact",
      "marketing.securityItem1",
      "marketing.securityItem10",
    ];
    for (const key of removed) {
      expect(key in ar, `${key} يجب أن يكون محذوفًا من العربية`).toBe(false);
      expect(key in en, `${key} يجب أن يكون محذوفًا من الإنجليزية`).toBe(false);
    }
  });

  it("التصور المعتمد حاضر: مراجعة + أدلة + بصمة + Apache-2.0 + حالة غير إنتاجية", () => {
    expect(ar["marketing.heroTitleAccent"]).toContain("قابل للمراجعة");
    expect(ar["marketing.heroSub"]).toContain("ليست ضمانًا مطلقًا");
    expect(ar["marketing.whyOutputsBody"]).toContain("البصمة الرقمية");
    expect(ar["marketing.openSub"]).toContain("Apache-2.0");
    expect(ar["marketing.footerBadge"]).toBe("Apache-2.0 · مفتوح المصدر");
    expect(ar["marketing.tierCloudBadge"]).toBe("غير متاح بعد");
    expect(ar["marketing.faq5a"]).toContain("محظورًا");
    expect(en["marketing.heroTitleAccent"]).toBe("a reviewable MCP server");
    expect(en["marketing.tierCloudBadge"]).toBe("Not available yet");
  });

  it("لا مفاتيح تسويق فارغة في أي لغة", () => {
    for (const [key, value] of [...MARKETING_AR, ...MARKETING_EN]) {
      expect(value.trim().length, `المفتاح ${key} فارغ`).toBeGreaterThan(0);
    }
  });
});
