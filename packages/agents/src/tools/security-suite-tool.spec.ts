/**
 * اختبارات أداة run_security_suite — التحقق أنها تشغل محرك التحصين
 * الحقيقي على الartifact المعطى وتلخص النتائج بدقة.
 */

import { describe, expect, it } from "vitest";
import type { GeneratedServerArtifact } from "@agentbridge/shared";
import { createRunSecuritySuiteTool } from "./security-suite-tool.js";

const sound: GeneratedServerArtifact = {
  files: [
    {
      path: "manifest.json",
      contents: JSON.stringify({ name: "demo", tools: [{ name: "list_pets", description: "List pets." }] }),
    },
    {
      path: "src/tools.ts",
      contents: "export const tool = { name: 'list_pets', inputSchema: {} } as const;\n",
    },
    { path: "src/config.ts", contents: "const UPSTREAM_BASE_URL = process.env.UPSTREAM_BASE_URL;\n" },
  ],
  toolNames: ["list_pets"],
};

const dirty: GeneratedServerArtifact = {
  files: [
    ...sound.files,
    { path: "src/extra.ts", contents: "const code = eval('1+1');\n" },
  ],
  toolNames: ["list_pets"],
};

const ALL_IDS = Array.from({ length: 13 }, (_unused, index) => `HB-${String(index + 1).padStart(2, "0")}`); // HB-13 مضمّن

describe("run_security_suite", () => {
  it("يشغل الفحوص الساكنة العشرة الحقيقية ويلخص الإحصاء بدقة", async () => {
    const tool = createRunSecuritySuiteTool(sound);
    const result = await tool.execute({}, { tenantId: "t1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalChecks).toBe(13); // HB-13 انضم للفحوص الساكنة
    expect(result.value.checks.map((check) => check.id)).toEqual(ALL_IDS);
    const manualPassed = result.value.checks.filter((check) => check.passed).length;
    expect(result.value.passedCount).toBe(manualPassed);
  });

  it("يلتقط الفحص الفاشل في artifact فيه eval ويذكر الموضع", async () => {
    const tool = createRunSecuritySuiteTool(dirty);
    const result = await tool.execute({}, { tenantId: "t1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passedCount).toBeLessThan(result.value.totalChecks);
    const failed = result.value.checks.filter((check) => !check.passed);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.some((check) => check.location?.includes("src/extra.ts") ?? false)).toBe(true);
  });

  it("مدخل زائد يرفض بالمخطط الصارم", async () => {
    const tool = createRunSecuritySuiteTool(sound);
    const result = await tool.execute({ extra: 1 }, { tenantId: "t1" });
    expect(result.ok).toBe(false);
  });
});
