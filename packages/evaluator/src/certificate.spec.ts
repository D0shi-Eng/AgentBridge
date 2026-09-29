/**
 * اختبارات قرار الشهادة — البوابتان الحاسمتان:
 *   1. عتبة 85 مع دمج الجودة عند توفره.
 *   2. الرفض الحرج بغض النظر عن الدرجة.
 * وبصمة الـartifacts ورقم التحقق الحتمي.
 */

import { describe, expect, it } from "vitest";
import type { GeneratedServerArtifact, LiveProbeEvidence, SecurityReport } from "@agentbridge/shared";
import {
  CERTIFICATION_THRESHOLD,
  certifyArtifacts,
  computeArtifactsHash,
} from "./certificate.js";

const ARTIFACT: GeneratedServerArtifact = {
  files: [
    { path: "src/server.ts", contents: "console.log('server');\n" },
    { path: "package.json", contents: '{"name":"x"}\n' },
    { path: "src/tools.ts", contents: "export {};\n" },
  ],
  toolNames: ["list_pets"],
};

/** تقرير مكتمل نظيف — 12 فحصاً كلها مجتازة */
const CLEAN_REPORT: SecurityReport = {
  findings: [],
  totalChecks: 12,
  passedCount: 12,
  hasCritical: false,
  cleanlinessScore: 100,
};

function reportWith(
  overrides: Partial<SecurityReport> & { findings?: SecurityReport["findings"] },
): SecurityReport {
  return { ...CLEAN_REPORT, ...overrides };
}

/** دليل فئات حية صالح مرتبط بالـartifact نفسه — شرط المنح في العقد الجديد */
function liveOk(): LiveProbeEvidence {
  return {
    checksTotal: 7,
    checksPassed: 7,
    probedArtifactsHash: computeArtifactsHash(ARTIFACT),
    executedAt: "2026-08-23T00:00:00.000Z",
  };
}

/** مدخل منح: تقرير نظيف + دليل حي صالح */
function grantedInput(extra: Partial<Parameters<typeof certifyArtifacts>[0]> = {}) {
  return {
    artifact: ARTIFACT,
    securityReport: CLEAN_REPORT,
    liveProbeEvidence: liveOk(),
    now: "2026-08-23T00:00:00.000Z",
    ...extra,
  };
}

describe("computeArtifactsHash", () => {
  it("حتمية: نفس المدخل = نفس البصمة", () => {
    expect(computeArtifactsHash(ARTIFACT)).toBe(computeArtifactsHash(ARTIFACT));
  });

  it("لا يعتمد على ترتيب وصول الملفات — يرتب بالمسمى قبل التجزئة", () => {
    const shuffled: GeneratedServerArtifact = {
      files: [...ARTIFACT.files].reverse(),
      toolNames: [...ARTIFACT.toolNames],
    };
    expect(computeArtifactsHash(shuffled)).toBe(computeArtifactsHash(ARTIFACT));
  });

  it("تغيير بايت واحد في أي ملف يغير البصمة كلياً", () => {
    const firstFile = ARTIFACT.files[0];
    if (firstFile === undefined) throw new Error("التركيبة تحتوي ملفاً واحداً على الأقل");
    const tampered: GeneratedServerArtifact = {
      files: [{ path: firstFile.path, contents: "console.log('tampered');\n" }, ...ARTIFACT.files.slice(1)],
      toolNames: [...ARTIFACT.toolNames],
    };
    expect(computeArtifactsHash(tampered)).not.toBe(computeArtifactsHash(ARTIFACT));
  });
});

describe("certifyArtifacts — القرار السليم", () => {
  it("تحصين نظيف كامل = شهادة منححة بدرجة 100 ≥ العتبة", () => {
    const result = certifyArtifacts(grantedInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.granted).toBe(true);
    expect(result.value.finalScore).toBe(100);
    expect(result.value.finalScore).toBeGreaterThanOrEqual(CERTIFICATION_THRESHOLD);
    expect(result.value.issuedAt).toBe("2026-08-23T00:00:00.000Z");
  });

  it("رقم التحقق بصيغة AB-16hex حتمي من (رباط التشغيل، بصمة، درجة، سياسة) — الزمن خارجه", () => {
    const first = certifyArtifacts(grantedInput());
    const second = certifyArtifacts(grantedInput());
    if (!first.ok || !second.ok) throw new Error("يجب أن تنجح المدخلات النظيفة");
    expect(first.value.verificationId).toMatch(/^AB-[0-9a-f]{16}$/);
    expect(first.value.verificationId).toBe(second.value.verificationId);

    // الزمن لم يعد مفتاح هوية — إعادة الإصدار لاحقاً تعيد نفس الرقم
    // (idempotency منطقي يمنع تكرار شهادة التشغيل الواحد)، والتمييز بالرباط
    const later = certifyArtifacts(grantedInput({ now: "2026-08-24T10:00:00.000Z" }));
    if (!later.ok) throw new Error("يجب أن تنجح");
    expect(later.value.verificationId).toBe(first.value.verificationId);

    const otherRun = certifyArtifacts(grantedInput({
      runBinding: { runId: "run-other", tenantId: "t", policyVersion: "other-policy-1" },
    }));
    if (!otherRun.ok) throw new Error("يجب أن تنجح");
    expect(otherRun.value.verificationId).not.toBe(first.value.verificationId);
  });

  it("درجات جودة مثالية تُدمج 60/40 دون تغيير النتيجة عن 100", () => {
    const result = certifyArtifacts(grantedInput({
      qualityScores: [{ toolName: "list_pets", score: 100, reasons: ["وصف موثق بالكامل"] }],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.finalScore).toBe(100);
    expect(result.value.granted).toBe(true);
  });

  it("جودة متوسطة 80 مع أمان 100 تعطي 92 ومنحتاً", () => {
    const result = certifyArtifacts(grantedInput({
      qualityScores: [{ toolName: "list_pets", score: 80, reasons: ["أوصاف مقبولة"] }],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.finalScore).toBe(92);
    expect(result.value.granted).toBe(true);
  });

  it("نظافة 70 تحت العتبة = رفض رغم غياب الحرجة", () => {
    const weak: SecurityReport = reportWith({
      totalChecks: 12,
      passedCount: 9,
      cleanlinessScore: 70,
      findings: [{ id: "HB-07", severity: "medium", title: "أداة بمخطط ناقص" }],
    });
    const result = certifyArtifacts({ artifact: ARTIFACT, securityReport: weak });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.finalScore).toBe(70);
    expect(result.value.granted).toBe(false);
  });

  it("عند حدود العتبة تماماً (85) تُمنح الشهادة", () => {
    const borderline: SecurityReport = reportWith({ totalChecks: 12, passedCount: 10, cleanlinessScore: 85 });
    const result = certifyArtifacts(grantedInput({ securityReport: borderline }));
    if (!result.ok) throw new Error("يجب أن تنجح");
    expect(result.value.granted).toBe(true);
  });
});

describe("certifyArtifacts — بوابة الرفض الحرجة", () => {
  it("نتيجة حرجة ترفض الشهادة حتى لو ادعى التقرير درجة كاملة", () => {
    // مدخل متنافٍ عمداً: hasCritical=true مع cleanlinessScore=100 —
    // البوابة تلزم granted=false مهما كانت الدرجة المعلنة (وثيقة 03 §6)
    const poisoned: SecurityReport = reportWith({
      hasCritical: true,
      findings: [{ id: "HB-01", severity: "critical", title: "eval في الكود المولد", location: "src/tools.ts:3" }],
    });
    const result = certifyArtifacts({
      artifact: ARTIFACT,
      securityReport: poisoned,
      qualityScores: [{ toolName: "list_pets", score: 100, reasons: ["جودة مثالية لا تعوّض الحرجة"] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.granted).toBe(false);
  });

  it("حرجة مخفية داخل findings دون رفع hasCritical تُكتشف بإعادة الفحص", () => {
    const sneaky: SecurityReport = reportWith({
      hasCritical: false, // الكاذبة — سنكشفها من القائمة
      findings: [{ id: "HD-02", severity: "critical", title: "تسريب سر عبر الخطأ" }],
      cleanlinessScore: 100,
    });
    const result = certifyArtifacts({ artifact: ARTIFACT, securityReport: sneaky });
    if (!result.ok) throw new Error("يجب أن تنجح");
    expect(result.value.granted).toBe(false);
  });
});

describe("certifyArtifacts — بوابات المدخلات (لا ثقة عمياء)", () => {
  it("تقرير مخالف للمخطط (درجة 101) يرفض الإصدار بخطأ منظّم", () => {
    const invalid = { ...CLEAN_REPORT, cleanlinessScore: 101 } as unknown as SecurityReport;
    const result = certifyArtifacts({ artifact: ARTIFACT, securityReport: invalid });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CERT_INVALID_SECURITY_REPORT");
  });

  it("تقرير بحقل زائد يرفض (strict)", () => {
    const extraField = { ...CLEAN_REPORT, surprise: true };
    const result = certifyArtifacts({ artifact: ARTIFACT, securityReport: extraField as unknown as SecurityReport });
    expect(result.ok).toBe(false);
  });

  it("تقرير صفر فحوص لا يكفي لقرار — خطأ CERT_NO_CHECKS_EXECUTED", () => {
    const empty = reportWith({ totalChecks: 0, passedCount: 0 });
    const result = certifyArtifacts({ artifact: ARTIFACT, securityReport: empty });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CERT_NO_CHECKS_EXECUTED");
  });

  it("درجة جودة مخالفة للعقد (150) ترفض الإصدار كلياً", () => {
    const badQuality = [
      { toolName: "list_pets", score: 150, reasons: ["خارج المدى"], },
    ] as unknown as NonNullable<import("@agentbridge/shared").QualityScore[]>;
    const result = certifyArtifacts({ artifact: ARTIFACT, securityReport: CLEAN_REPORT, qualityScores: badQuality });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CERT_INVALID_QUALITY_SCORES");
  });

  it("قائمة جودة فارغة تعامل كغياب للجودة لا كخطأ", () => {
    const result = certifyArtifacts({ artifact: ARTIFACT, securityReport: CLEAN_REPORT, qualityScores: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.finalScore).toBe(100);
  });
});
