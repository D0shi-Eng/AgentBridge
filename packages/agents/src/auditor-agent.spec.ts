/**
 * اختبارات وكيل المدقق AuditorAgent — البوابات والتغطية والترتيب.
 */

import { describe, expect, it } from "vitest";
import type { AuditedFinding, GeneratedServerArtifact, SecurityFinding, SecurityReport } from "@agentbridge/shared";
import { MockLlmProvider } from "@agentbridge/llm";
import { AuditorAgent, checkCoverage } from "./auditor-agent.js";

const artifact: GeneratedServerArtifact = {
  files: [{ path: "manifest.json", contents: '{"tools":[]}' }],
  toolNames: ["list_pets"],
};

const findings: SecurityFinding[] = [
  {
    id: "HB-03",
    severity: "high",
    title: "شبكة خام",
    location: "src/upstream-client.ts:8",
    detail: "استيراد node:http خارج القناة",
  },
  {
    id: "HB-06",
    severity: "medium",
    title: "حقن في وصف",
    location: "src/tools.ts:12",
  },
];

const report: SecurityReport = {
  findings,
  totalChecks: 14,
  passedCount: 12,
  hasCritical: false,
  cleanlinessScore: 75,
};

/** يبني مخرج مدقق صحيح التغطية من النتائج الواصلة */
function validAudited(): string {
  return JSON.stringify({
    audited: findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      title: finding.title,
      ...(finding.location !== undefined ? { location: finding.location } : {}),
      recommendedFix: `أصلح ${finding.id} في موقعه المعلن فوراً`,
    })),
  });
}

describe("AuditorAgent", () => {
  it("تقرير سليم يعود مرتباً بحسب الخطورة وroundsUsed=1", async () => {
    const provider = new MockLlmProvider({ responses: [validAudited()] });
    const result = await new AuditorAgent(provider).audit({ artifact, securityReport: report, tenantId: "t1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roundsUsed).toBe(1);
    expect(result.value.auditedFindings.map((item) => item.id)).toEqual(["HB-03", "HB-06"]);
    expect(result.value.auditedFindings[0]?.recommendedFix.length).toBeGreaterThan(5);
  });

  it("خرج ناقص التغطية يُغذى راجعة ثم يقبل في الدورة الثانية", async () => {
    const partial = JSON.stringify({
      audited: [
        {
          id: "HB-03",
          severity: "high",
          title: "شبكة خام",
          location: "src/upstream-client.ts:8",
          recommendedFix: "أزل الاستيراد الخام واستخدم عميل upstream الموحد",
        },
      ],
    });
    const provider = new MockLlmProvider({ responses: [partial, validAudited()] });
    const result = await new AuditorAgent(provider).audit({ artifact, securityReport: report, tenantId: "t1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roundsUsed).toBe(2);
  });

  it("معرف مخترع لا يُقبل حتى لو اكتمل العدد", async () => {
    const invented = JSON.stringify({
      audited: [
        ...JSON.parse(validAudited()).audited,
        { id: "HB-99", severity: "info", title: "اختراع", recommendedFix: "لا شيء" },
      ],
    });
    const provider = new MockLlmProvider({ responses: [invented] });
    const result = await new AuditorAgent(provider).audit({ artifact, securityReport: report, tenantId: "t1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // الدورات الثلاث كلها رُفضت لأن الطابور أعاد نفس المخترع ثلاث مرات؟
    // لا: الطابور نضب بعد الرد الأول والدالة الاحتياطية غائبة → فشل مزود
    expect(result.error.code).toMatch(/AUDIT|LLM/);
  });

  it("ثلاث دورات سيئة متتالية تنتهي بفشل منظم AUDIT_ROUNDS_EXHAUSTED", async () => {
    const bad = JSON.stringify('{"audited":"بدل المصفوفة نص"}');
    const provider = new MockLlmProvider({ responses: [bad, bad, bad] });
    const result = await new AuditorAgent(provider).audit({ artifact, securityReport: report, tenantId: "t1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUDIT_ROUNDS_EXHAUSTED");
  });
});

describe("checkCoverage — بوابة التغطية الحتمية", () => {
  const first: AuditedFinding = {
    id: "A",
    severity: "high",
    title: "t1",
    recommendedFix: "إصلاح محدد كافٍ",
  };
  const second: AuditedFinding = {
    id: "B",
    severity: "info",
    title: "t2",
    recommendedFix: "إصلاح آخر محدد",
  };
  const originals: SecurityFinding[] = [
    { id: "A", severity: "high", title: "t1" },
    { id: "B", severity: "info", title: "t2" },
  ];

  it("نقص تغطية يرفض ويذكر المعرف الناقص", () => {
    const result = checkCoverage([first], originals);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("B");
  });

  it("تكرار معرف يرفض", () => {
    const result = checkCoverage([first, first], originals);
    expect(result.ok).toBe(false);
  });

  it("تعديل حقل ثابت (severity/title/location) يرفض — النموذج يكتب التوصية فقط", () => {
    const tampered: AuditedFinding = { ...second, id: "A", title: "عنوان مغاير" };
    const result = checkCoverage([tampered], originals);
    expect(result.ok).toBe(false);
  });

  it("تغطية مطابقة كاملة تمر وتعيد القائمة كما هي", () => {
    const result = checkCoverage([first, second], originals);
    expect(result.ok).toBe(true);
  });
});
