/**
 * اختبارات قاموس التدويل — يثبت أن كل مفتاح له ترجمتان وأن t حتمي.
 */

import { describe, expect, it } from "vitest";
import { I18N_KEYS, t } from "./i18n.js";

describe("shared i18n", () => {
  it("كل مفتاح له ترجمتان ar و en غير فارغتين", () => {
    for (const key of I18N_KEYS) {
      const ar = t(key, "ar");
      const en = t(key, "en");
      expect(ar.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
      expect(ar).not.toBe(en);
    }
  });

  it("t يعوض المتغيرات {{var}}", () => {
    const ar = t("error.SPEC_PARSE_FAILED", "ar", { detail: "نقص حقل info" });
    expect(ar).toContain("نقص حقل info");
    const en = t("error.SPEC_PARSE_FAILED", "en", { detail: "missing info" });
    expect(en).toContain("missing info");
  });

  it("نفس المفتاح والمتغيرات يعطي نفس الناتج حتمياً", () => {
    expect(t("error.UNAUTHORIZED", "ar")).toBe(t("error.UNAUTHORIZED", "ar"));
    expect(t("error.UNAUTHORIZED", "en")).toBe(t("error.UNAUTHORIZED", "en"));
  });
});
