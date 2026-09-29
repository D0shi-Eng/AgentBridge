import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GeneratedServerArtifact } from "@agentbridge/shared";
import { writeArtifact } from "./writer.js";

/** artifact مصغر بملفين متداخلين لاختبار الكتابة العودية */
const sample: GeneratedServerArtifact = {
  files: [
    { path: "package.json", contents: "{}\n" },
    { path: "src/server.ts", contents: "// خادم\n" },
    { path: "README.md", contents: "# دليل\n" },
  ],
  toolNames: [],
};

describe("writeArtifact — حراس القرص", () => {
  let baseDir: string;

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ab-writer-"));
  });
  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("يكتب كل الملفات مع إنشاء المجلدات الوسيطة", async () => {
    const target = join(baseDir, "fresh");
    const result = await writeArtifact(sample, { targetDir: target });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.writtenFiles).toBe(3);

    const nested = await readFile(join(target, "src", "server.ts"), "utf8");
    expect(nested).toContain("خادم");
  });

  it("يقبل مجلداً قائماً فارغاً تماماً", async () => {
    const emptyDir = join(baseDir, "empty-dir");
    await mkdir(emptyDir);
    const result = await writeArtifact(sample, { targetDir: emptyDir });
    expect(result.ok).toBe(true);
  });

  it("يرفض الطمس فوق مجلد غير فارغ برمز GEN_DIR_NOT_EMPTY", async () => {
    const dirty = join(baseDir, "dirty");
    await mkdir(dirty);
    await writeFile(join(dirty, "existing.txt"), "لا تمسني", "utf8");
    const result = await writeArtifact(sample, { targetDir: dirty });
    expect(!result.ok && result.error.code).toBe("GEN_DIR_NOT_EMPTY");
  });

  it("يصد اجتياز المسارات بمسار مطلق خارج الهدف", async () => {
    const target = join(baseDir, "guard");
    const malicious: GeneratedServerArtifact = {
      files: [{ path: "../outside.txt", contents: "هروب" }],
      toolNames: [],
    };
    const result = await writeArtifact(malicious, { targetDir: target });
    expect(!result.ok && result.error.code).toBe("GEN_DIR_NOT_EMPTY");
    // لم يُكتب شيء خارج الهدف
    const parentEntries = await readdir(baseDir);
    expect(parentEntries).not.toContain("outside.txt");
  });
});
