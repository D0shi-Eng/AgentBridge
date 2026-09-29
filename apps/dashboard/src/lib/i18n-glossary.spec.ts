/**
 * حارس المعجم الملزم.
 *
 * يثبّت قرارات التدقيق العربي الحرفي ضد الارتداد: المصطلحات الملزمة
 * (عملية تشغيل / مسار المعالجة / مساحة العمل / إبطال / منتهية الصلاحية /
 * بصمة رقمية / سجل مترابط بالتجزئة / معرّف التحقق)، نصوص الحالات الخمسة
 * لصفحة التحقق، إخلاء المسؤولية الحرفي، تعريب أسماء البطاقات في العربية
 * حصراً، ومنع الرسائل الخام وعلامات الترقيم المعكوسة.
 */

import { describe, expect, it } from "vitest";
import { ar } from "./i18n/ar.js";
import { en } from "./i18n/en.js";

const AR_VALUES = Object.entries(ar);

describe("المعجم الملزم", () => {
  it("لا «المستأجر» في أي قيمة معروضة — مساحة العمل هي المعتمد في الواجهة", () => {
    const hits = AR_VALUES.filter(([, v]) => v.includes("المستأجر") || v.includes("مستأجر"));
    expect(hits.map(([k]) => k)).toEqual([]);
  });

  it("لا «خط الأنابيب» ولا «خط أنبوب» — مسار المعالجة هو المعتمد", () => {
    const hits = AR_VALUES.filter(([, v]) => v.includes("خط الأنابيب") || v.includes("خط أنبوب"));
    expect(hits.map(([k]) => k)).toEqual([]);
    expect(ar["stage.label"]).toBe("مراحل مسار المعالجة الثماني");
  });

  it("«run» في التسميات المستقلة = عملية تشغيل لا «تشغيلات» المجردة", () => {
    expect(ar["overview.recentRuns"]).toBe("آخر عمليات التشغيل");
    expect(ar["stats.totalRuns"]).toBe("إجمالي عمليات التشغيل");
    expect(ar["breadcrumb.run"]).toBe("عملية تشغيل");
    expect(ar["error.runAlreadyActive"]).toContain("عملية تشغيل نشطة");
  });

  it("أسماء البطاقات الثلاث معرّبة في العربية والإنجليزية فقط في الإنجليزية", () => {
    expect(ar["marketing.tierCommunity"]).toBe("المجتمع");
    expect(ar["marketing.tierCloud"]).toBe("السحابة المُدارة");
    expect(ar["marketing.tierEnterprise"]).toBe("دعم المؤسسات");
    expect(en["marketing.tierCommunity"]).toBe("Community");
    expect(en["marketing.tierCloud"]).toBe("Managed Cloud");
    expect(en["marketing.tierEnterprise"]).toBe("Enterprise Support");
  });

  it("نصوص التحقق الخمسة بالصياغة الملزمة حرفياً", () => {
    expect(ar["verify.granted"]).toBe("نتيجة التحقق: مستوفاة");
    expect(ar["verify.denied"]).toBe("نتيجة التحقق: غير مستوفاة");
    expect(ar["verify.revokedTitle"]).toBe("نتيجة التحقق: مُبطلة");
    expect(ar["verify.expiredTitle"]).toBe("نتيجة التحقق: منتهية الصلاحية");
    expect(ar["verify.invalidSignatureTitle"]).toBe("تعذر التحقق من التوقيع");
    expect(ar["verify.missingTitle"]).toBe("لم يُعثر على معرّف التحقق");
  });

  it("إخلاء المسؤولية الملزم بنصه الحرفي في اللغتين", () => {
    expect(ar["verify.disclaimer"]).toBe(
      "توثّق هذه الصفحة نتيجة فحوص محددة على بصمة محددة من المخرجات. ولا تمثل ضمانًا مطلقًا للأمان أو اعتمادًا لبيئة التشغيل الإنتاجية.",
    );
    expect(en["verify.disclaimer"]).toContain("not an absolute security guarantee");
  });

  it("المفتاح الخام «رد الخادم» محذوف نهائياً من القاموسين", () => {
    expect("error.serverMessage" in ar).toBe(false);
    expect("error.serverMessage" in en).toBe(false);
  });

  it("«بصمة رقمية» و«سجل مترابط بالتجزئة» و«بوابة تحقق» في مواضعها", () => {
    expect(ar["verify.factHash"]).toBe("البصمة الرقمية للمخرجات (SHA-256)");
    expect(ar["marketing.securityChainTitle"]).toContain("سجل تدقيق مترابط بالتجزئة");
    expect(ar["run.hitlExplain"]).toContain("السجل المترابط بالتجزئة");
    expect(ar["run.certDeniedCode.CRITICAL_FINDINGS"]).toContain("بوابة تحقق");
    expect(ar["run.certDeniedCode.SANDBOX_EVIDENCE_INVALID"]).toContain("بيئة التنفيذ المعزولة");
  });

  it("الأرقام والوحدات بمسافة: 512 كيلوبايت", () => {
    expect(ar["upload.acceptedTypes"]).toContain("512 كيلوبايت");
    expect(ar["upload.fileTooLarge"]).toContain("512 كيلوبايت");
    expect(ar["marketing.whyInputBody"]).toContain("512 كيلوبايت");
  });

  it("علامة الحذف في نهاية السلسلة المنطقية لا في أولها", () => {
    expect(ar["common.busy"].startsWith("…")).toBe(false);
    expect(ar["upload.starting"].startsWith("…")).toBe(false);
  });

  it("مفتاح منطقة التنبيهات موجود بدل السلسلة الصلبة المحذوفة", () => {
    expect(ar["common.notificationsArea"]).toBe("منطقة التنبيهات");
    expect(en["common.notificationsArea"]).toBe("Notifications");
  });

  it("حالة التشغيل غير الموجود لها نصوصها في اللغتين", () => {
    expect(ar["run.notFoundTitle"]).toContain("لم يُعثر");
    expect(en["run.notFoundTitle"]).toBe("Run not found");
  });
});
