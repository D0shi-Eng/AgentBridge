/**
 * اختبارات سياسة حدود الترقيع: مسارات canonical،
 * امتدادات مسموحة، ملفات قائمة حصراً، سقوف حجم ونمو، وdeadline الدورة.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPAIR_PATCH_POLICY,
  enforcePatchPolicy,
  enforceRepairDeadline,
  isCanonicalArtifactPath,
} from "./repair-policy.js";
import type { GeneratedFile, RepairPatch } from "@agentbridge/shared";

function files(entries: ReadonlyArray<readonly [string, string]>): GeneratedFile[] {
  return entries.map(([path, contents]) => ({ path, contents }));
}

function patch(entries: ReadonlyArray<readonly [string, string]>): RepairPatch {
  return {
    rationale: ["إصلاح موضعي موثق"],
    files: entries.map(([path, contents]) => ({ path, contents })),
  };
}

const base = files([
  ["src/server.ts", "export const a = 1;\n".repeat(10)],
  ["manifest.json", "{}"],
]);

describe("isCanonicalArtifactPath — لا خروج من workspace", () => {
  it("يرفض traversal والمطلق والمائل العكسي والنقاط", () => {
    expect(isCanonicalArtifactPath("src/server.ts")).toBe(true);
    expect(isCanonicalArtifactPath("../outside.ts")).toBe(false);
    expect(isCanonicalArtifactPath("src/../../etc/passwd")).toBe(false);
    expect(isCanonicalArtifactPath("/etc/passwd")).toBe(false);
    expect(isCanonicalArtifactPath("src\\server.ts")).toBe(false);
    expect(isCanonicalArtifactPath("C:/server.ts")).toBe(false);
    expect(isCanonicalArtifactPath("./server.ts")).toBe(false);
    expect(isCanonicalArtifactPath("")).toBe(false);
  });
});

describe("enforcePatchPolicy — بوابات الحدود", () => {
  it("ترقيع قانوني ضمن الحدود يمر", () => {
    const result = enforcePatchPolicy(patch([["src/server.ts", "export const a = 2;\n".repeat(10)]]), base);
    expect(result.ok).toBe(true);
  });

  it("امتداد غير مسموح — REPAIR_EXTENSION_FORBIDDEN", () => {
    const result = enforcePatchPolicy(patch([["src/server.sh", "#!/bin/sh"]]), base);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("REPAIR_EXTENSION_FORBIDDEN");
  });

  it("ملف غير قائم (اختراع) — REPAIR_PATH_UNSAFE", () => {
    const result = enforcePatchPolicy(patch([["src/new-file.ts", "x"]]), base);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("REPAIR_PATH_UNSAFE");
  });

  it("مسار غير canonical داخل الترقيع — REPAIR_PATH_UNSAFE", () => {
    const result = enforcePatchPolicy(patch([["../src/server.ts", "x"]]), base);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("REPAIR_PATH_UNSAFE");
  });

  it("ملف واحد فوق سقف البايتات — REPAIR_FILE_TOO_LARGE", () => {
    const huge = "x".repeat(DEFAULT_REPAIR_PATCH_POLICY.maxFileBytes + 1);
    const result = enforcePatchPolicy(patch([["src/server.ts", huge]]), base);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("REPAIR_FILE_TOO_LARGE");
  });

  it("نمو الـartifact فوق السقف — REPAIR_GROWTH_TOO_LARGE", () => {
    const custom = { ...DEFAULT_REPAIR_PATCH_POLICY, maxArtifactGrowthBytes: 10, maxFileBytes: 10_000 };
    const result = enforcePatchPolicy(patch([["src/server.ts", "y".repeat(500)]]), base, custom);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("REPAIR_GROWTH_TOO_LARGE");
  });
});

describe("enforceRepairDeadline — سقف زمن الدورة", () => {
  it("داخل المهلة يمر وفوقها يرفض برمز موحد", () => {
    expect(enforceRepairDeadline(1000, 500, 1200).ok).toBe(true);
    const exceeded = enforceRepairDeadline(1000, 500, 1600);
    expect(exceeded.ok).toBe(false);
    if (!exceeded.ok) expect(exceeded.error.code).toBe("REPAIR_DEADLINE_EXCEEDED");
  });
});
