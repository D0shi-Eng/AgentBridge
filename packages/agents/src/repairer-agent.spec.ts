/**
 * اختبارات وكيل الإصلاح RepairerAgent — بوابات الترقيع الثلاث والحلقة.
 */

import { describe, expect, it } from "vitest";
import type { AuditedFinding, FailureReport } from "@agentbridge/shared";
import { MockLlmProvider } from "@agentbridge/llm";
import { RepairerAgent, validatePatch } from "./repairer-agent.js";

const currentFiles = [
  "package.json",
  "tsconfig.json",
  "manifest.json",
  "README.md",
  "src/server.ts",
  "src/tools.ts",
  "src/config.ts",
  "src/upstream-client.ts",
].map((path) => ({ path, contents: `// ${path}\n` }));

const finding: AuditedFinding = {
  id: "HB-07",
  severity: "high",
  title: "أداة بلا مخطط مدخلات",
  location: "src/tools.ts:3",
  recommendedFix: "أضف inputSchema لكل أداة مسجلة في src/tools.ts",
};

const failure: FailureReport = {
  stage: "harden",
  summary: "فشل فحص مخططات الأدوات",
  findings: [finding],
  attempt: 1,
};

function validPatch(): string {
  return JSON.stringify({
    files: [
      {
        path: "src/tools.ts",
        contents: "// src/tools.ts\nexport const withSchema = { inputSchema: {} }; // أُضيف المخطط\n",
      },
    ],
    rationale: ["أضاف المخطط الناقص الذي طالبه HB-07"],
  });
}

describe("RepairerAgent", () => {
  it("ترقيع سليم يقبَل من الدورة الأولى", async () => {
    const provider = new MockLlmProvider({ responses: [validPatch()] });
    const result = await new RepairerAgent(provider).proposeRepair({
      failure,
      currentFiles,
      tenantId: "t1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files[0]?.path).toBe("src/tools.ts");
    expect(result.value.rationale.length).toBeGreaterThan(0);
  });

  it("ترقيع ملف غير موجود يُغذى راجعاً ثم يقبل عند التصحيح", async () => {
    const invented = JSON.stringify({
      files: [{ path: "src/brand-new.ts", contents: "x" }],
      rationale: ["محاولة أولى مرفوضة"],
    });
    const provider = new MockLlmProvider({ responses: [invented, validPatch()] });
    const result = await new RepairerAgent(provider).proposeRepair({
      failure,
      currentFiles,
      tenantId: "t1",
    });
    expect(result.ok && result.value.files[0]?.path === "src/tools.ts").toBe(true);
  });

  it("لمس كل الملفات = إعادة توليد مقنّعة ترفض بPATCH_TOO_BROAD", () => {
    const everything = currentFiles.map((file) => ({ path: file.path, contents: "x" }));
    const result = validatePatch(
      { files: everything, rationale: ["إعادة كل شيء"] },
      currentFiles,
    );
    expect(!result.ok && result.error.code).toBe("PATCH_TOO_BROAD");
  });

  it("تبرير فارغ يرفض بPATCH_NO_RATIONALE", () => {
    const result = validatePatch(
      { files: [{ path: "src/tools.ts", contents: "x" }], rationale: [] },
      currentFiles,
    );
    expect(!result.ok && result.error.code).toBe("PATCH_NO_RATIONALE");
  });

  it("ثلاث دورات رديئة تنتهي بREPAIR_ROUNDS_EXHAUSTED (تصعيد بشري)", async () => {
    const bad = '{"files": "نص بدل مصفوفة"}';
    const provider = new MockLlmProvider({ responses: [bad, bad, bad] });
    const result = await new RepairerAgent(provider).proposeRepair({
      failure,
      currentFiles,
      tenantId: "t1",
    });
    expect(!result.ok && result.error.code).toBe("REPAIR_ROUNDS_EXHAUSTED");
  });

  it("فشل المزود يمرر منظماً", async () => {
    const provider = new MockLlmProvider({});
    const result = await new RepairerAgent(provider).proposeRepair({
      failure,
      currentFiles,
      tenantId: "t1",
    });
    expect(result.ok).toBe(false);
  });
});
