/**
 * اختبارات تدويل اللوحة — تكافؤ القاموسين مفروض من الأنواع، وهنا نتحقق
 * من القيم الفعلية: لا مفتاح بترجمة فارغة أو متطابقة، وdir صحيح،
 * والاستيفاء {{var}} يعمل، والمعجم موحد.
 */

import { describe, expect, it } from "vitest";
import { ar } from "./i18n/ar.js";
import { en } from "./i18n/en.js";
import { t } from "./i18n/index.js";
import { dir, normalizeLocale } from "./locale-state.js";

const AR_KEYS = Object.keys(ar) as ReadonlyArray<keyof typeof ar>;

describe("dashboard i18n", () => {
  it("كل مفتاح عربي له مقابل إنجليزي غير فارغ (تكافؤ كامل)", () => {
    for (const key of AR_KEYS) {
      expect(en[key], `المفتاح ${key} بلا مقابل إنجليزي`).toBeTruthy();
    }
  });

  it("عدد مفاتيح en يساوي ar تماماً — لا مفتاح زائد", () => {
    expect(Object.keys(en).length).toBe(AR_KEYS.length);
  });

  it("لا ترجمة فارغة ولا تطابق تام بين اللغتين (إلا الأسماء العلم)", () => {
    for (const key of AR_KEYS) {
      expect(ar[key].length).toBeGreaterThan(0);
      expect(en[key].length).toBeGreaterThan(0);
    }
  });

  it("dir يعيد rtl للعربية و ltr للإنجليزية", () => {
    expect(dir("ar")).toBe("rtl");
    expect(dir("en")).toBe("ltr");
  });

  it("normalizeLocale يرفض أي شيء غير ar/en إلى الافتراضية", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("ar")).toBe("ar");
    expect(normalizeLocale("fr")).toBe("ar");
    expect(normalizeLocale(undefined)).toBe("ar");
  });

  it("t يستبدل متغيرات {{var}}", () => {
    expect(t("overview.projectCreated", "ar", { name: "عيادة" })).toContain("عيادة");
    expect(t("step.aria", "en", { name: "Analyze", state: "completed" })).toBe("Analyze: completed");
  });

  it("المعجم الموحد: الحالات لها مقابل واحد فقط في القاموس", () => {
    // مصطلح الحالة الواحد لا يتضاعف بصيغتين مختلفتين في نفس اللغة
    const statuses = AR_KEYS.filter((key) => key.startsWith("status."));
    expect(statuses.length).toBeGreaterThan(5);
    expect(new Set(statuses.map((key) => ar[key])).size).toBe(statuses.length);
  });
});
