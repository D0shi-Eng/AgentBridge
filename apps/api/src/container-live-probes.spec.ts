/**
 * اختبارات توصيل فئات الفحص الحي من إعداد الخادم (env) إلى الحاوية —
 * العقد: الافتراضي مغلق (لا فئات حية لا شهادة)، و"1" هو المصدر الوحيد
 * المسموح غير الاختباري، وتجاوز الاختبارات يبقى الأقوى كما هو.
 */
import { describe, expect, it } from "vitest";
import { buildContainer, developmentEnv } from "./container.js";

describe("توصيل الفئات الحية من env إلى الحاوية", () => {
  it("الافتراضي بلا إعداد ⇒ liveProbes/sandboxProbes غير مضبوطتين (السلوك التاريخي)", async () => {
    const container = await buildContainer({ env: developmentEnv() });
    try {
      expect(container.liveProbes).toBeUndefined();
      expect(container.sandboxProbes).toBeUndefined();
    } finally {
      await container.close?.();
    }
  });

  it("AGENTBRIDGE_*_PROBES=1 ⇒ الحاوية تحمل الفئات الحية من إعداد الخادم", async () => {
    const container = await buildContainer({
      env: { ...developmentEnv(), AGENTBRIDGE_LIVE_PROBES: "1", AGENTBRIDGE_SANDBOX_PROBES: "1" },
    });
    try {
      expect(container.liveProbes).toBe(true);
      expect(container.sandboxProbes).toBe(true);
    } finally {
      await container.close?.();
    }
  });

  it('قيمة "0" تبقي الإغلاق — الغياب يبقى غياباً لا قيمة صريحة', async () => {
    const container = await buildContainer({
      env: { ...developmentEnv(), AGENTBRIDGE_LIVE_PROBES: "0", AGENTBRIDGE_SANDBOX_PROBES: "0" },
    });
    try {
      expect(container.liveProbes).toBeUndefined();
      expect(container.sandboxProbes).toBeUndefined();
    } finally {
      await container.close?.();
    }
  });

  it("قيمة غير ثنائية ⇒ رفض إقلاع برسالة عربية تحدد الحقل", async () => {
    const error = await buildContainer({
      env: { ...developmentEnv(), AGENTBRIDGE_LIVE_PROBES: "yes" },
    }).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).not.toBeNull();
    expect(String((error as Error).message)).toContain("AGENTBRIDGE_LIVE_PROBES");
  });
});
