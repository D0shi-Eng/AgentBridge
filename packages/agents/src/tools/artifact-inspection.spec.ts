/**
 * اختبارات أدوات فحص الـartifact — عقد القراءة فقط وعقد grep.
 */

import { describe, expect, it } from "vitest";
import type { GeneratedServerArtifact } from "@agentbridge/shared";
import { createGrepArtifactTool, createReadArtifactSourceTool } from "./artifact-inspection.js";

const artifact: GeneratedServerArtifact = {
  files: [
    { path: "manifest.json", contents: '{\n "tools": []\n}\n' },
    { path: "src/tools.ts", contents: "const x = 1;\nexport const evil = eval('2');\n" },
  ],
  toolNames: ["list_pets"],
};

describe("read_artifact_source", () => {
  it("يعيد الملف بأسطر مرقمة تبدأ من 1", async () => {
    const tool = createReadArtifactSourceTool(artifact);
    const result = await tool.execute({ path: "src/tools.ts" }, { tenantId: "t1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.numberedLines[1]).toBe("2: export const evil = eval('2');");
  });

  it("ملف غير موجود يرفض برسالة عربية تحمل المسار", async () => {
    const tool = createReadArtifactSourceTool(artifact);
    const result = await tool.execute({ path: "nope.ts" }, { tenantId: "t1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("nope.ts");
  });

  it("مدخل مخالف للمخطط يرفض قبل التنفيذ", async () => {
    const tool = createReadArtifactSourceTool(artifact);
    // مدخل مقصود الفساد — التحويل مبرر لاختبار البوابة نفسها
    const result = await tool.execute({ wrong: true } as unknown as { path: string }, { tenantId: "t1" });
    expect(result.ok).toBe(false);
  });
});

describe("grep_artifact", () => {
  it("يعيد المواضع بأرقام أسطر دقيقة", async () => {
    const tool = createGrepArtifactTool(artifact);
    const result = await tool.execute({ pattern: "eval\\(" }, { tenantId: "t1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toBe(1);
    expect(result.value.hits[0]?.path).toBe("src/tools.ts");
    expect(result.value.hits[0]?.line).toBe(2);
  });

  it("caseInsensitive يوسع المطابقة", async () => {
    const tool = createGrepArtifactTool(artifact);
    const sensitive = await tool.execute({ pattern: "EVAL" }, { tenantId: "t1" });
    const insensitive = await tool.execute({ pattern: "EVAL", caseInsensitive: true }, { tenantId: "t1" });
    expect(sensitive.ok && sensitive.value.total === 0).toBe(true);
    expect(insensitive.ok && insensitive.value.total === 1).toBe(true);
  });

  it("نمط regex غير صالح يرفض منظماً لا يرمي", async () => {
    const tool = createGrepArtifactTool(artifact);
    const result = await tool.execute({ pattern: "([" }, { tenantId: "t1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("regex");
  });

  it("لا نتائج يعيد قائمة فارغة بنجاح", async () => {
    const tool = createGrepArtifactTool(artifact);
    const result = await tool.execute({ pattern: "لا-موجود" }, { tenantId: "t1" });
    expect(result.ok && result.value.total === 0).toBe(true);
  });
});
