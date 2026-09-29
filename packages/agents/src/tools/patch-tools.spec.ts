/**
 * اختبارات أدوات apply_patch وretest_scope — التنفيذ الحتمي للترقيع.
 */

import { describe, expect, it } from "vitest";
import type { GeneratedServerArtifact } from "@agentbridge/shared";
import { createApplyPatchTool, createRetestScopeTool, type WorkingCopy } from "./patch-tools.js";

const base: GeneratedServerArtifact = {
  files: [
    { path: "manifest.json", contents: '{"tools":[{"name":"a_tool"}]}' },
    { path: "src/tools.ts", contents: "export const schema = {};\n" },
    { path: "src/config.ts", contents: "const UPSTREAM_BASE_URL = process.env.UPSTREAM_BASE_URL;\n" },
  ],
  toolNames: ["a_tool"],
};

function freshCopy(): WorkingCopy {
  return { files: base.files.map((file) => ({ ...file })) };
}

describe("apply_patch", () => {
  it("يستبدل محتوى ملف موجود فقط ويعيد المسارات المطبقة", async () => {
    const copy = freshCopy();
    const tool = createApplyPatchTool(copy);
    const result = await tool.execute(
      { files: [{ path: "src/tools.ts", contents: "export const schema = { inputSchema: true }; // أُصلح\n" }] },
      { tenantId: "t1" },
    );
    expect(result.ok && result.value.appliedPaths).toEqual(["src/tools.ts"]);
    expect(copy.files.find((file) => file.path === "src/tools.ts")?.contents).toContain("inputSchema");
    expect(copy.files).toHaveLength(3);
  });

  it("ملف جديد غير موجود يرفض — لا إضافة ملفات", async () => {
    const tool = createApplyPatchTool(freshCopy());
    const result = await tool.execute({ files: [{ path: "src/new.ts", contents: "x" }] }, { tenantId: "t1" });
    expect(!result.ok && result.error.code === "PATCH_UNKNOWN_FILE").toBe(true);
  });

  it("ترقيع فارغ الملفات يرفض بالمخطط", async () => {
    const tool = createApplyPatchTool(freshCopy());
    const result = await tool.execute({ files: [] }, { tenantId: "t1" });
    expect(result.ok).toBe(false);
  });
});

describe("retest_scope", () => {
  it("إعادة الكل تكشف الفشل بعد ترقيع ناقص", async () => {
    const copy = freshCopy();
    // نكسر عمداً: أداة بلا مخطط ثم نعيد الفحص كله
    copy.files[0] = { path: "manifest.json", contents: '{"tools":[]}' };
    const tool = createRetestScopeTool(copy, ["a_tool"]);
    const result = await tool.execute({ checkIds: [] }, { tenantId: "t1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.checks.length).toBeGreaterThan(0);
    expect(result.value.failedIds.length).toBeGreaterThan(0);
  });

  it("الحصر بمعرفات يعيد الفحوص المطلوبة فقط", async () => {
    const tool = createRetestScopeTool(freshCopy(), ["a_tool"]);
    const all = await tool.execute({ checkIds: [] }, { tenantId: "t1" });
    const scoped = await tool.execute({ checkIds: ["HB-01"] }, { tenantId: "t1" });
    expect(all.ok && scoped.ok).toBe(true);
    if (all.ok && scoped.ok) {
      expect(all.value.checks.length).toBe(13); // HB-13 انضم للفحوص الساكنة
      expect(scoped.value.checks.every((check) => check.id === "HB-01")).toBe(true);
    }
  });

  it("نسخة العمل المرقعة تعاد بالفحوص عليها لا على الأصل", async () => {
    const copy = freshCopy();
    const patcher = createApplyPatchTool(copy);
    await patcher.execute(
      { files: [{ path: "src/tools.ts", contents: "const x = eval('1');\n" }] },
      { tenantId: "t1" },
    );
    const tester = createRetestScopeTool(copy, ["a_tool"]);
    const result = await tester.execute({ checkIds: [] }, { tenantId: "t1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // eval دخلت عبر الترقيع فيجب أن يكشفها فحص HB-01
    expect(result.value.failedIds).toContain("HB-01");
  });
});
