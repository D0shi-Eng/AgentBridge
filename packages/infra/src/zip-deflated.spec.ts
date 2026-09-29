/**
 * اختبارات الضغط الحتمي buildDeflatedZip (S12-C) — مفصولة عن stored.
 * تكامل tar.exe يقرأ الأرشيف المضغوط بتطبيق bsdtar الرسمي على ويندوز.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildDeflatedZip } from "./zip-writer.js";

const run = promisify(execFile);

/**
 * أداة القراءة للتكامل الحقيقي: tar.exe الرسمي من System32 على ويندوز
 * (bsdtar يقرأ ZIP؛ GNU tar من git-bash لا). المسار صريح دائماً لأن
 * البيئة MSYS قد تعيد GNU tar الذي لا يفهم صيغة ZIP.
 */
function tarExe(): string {
  return process.platform === "win32" ? "C:/Windows/System32/tar.exe" : "tar";
}

describe("buildDeflatedZip — الضغط الحتمي S12-C", () => {
  const entries = [
    { path: "src/app.ts", contents: "a".repeat(5000) + "مرحبا".repeat(100) },
    { path: "README.md", contents: "# خادم\n" + "نص ".repeat(2000) },
  ];

  it("فك الضغط عبر inflateRawSync يطابق الأصل بايت-بايت", () => {
    const zip = buildDeflatedZip(entries);
    let offset = 0;
    for (const expected of entries) {
      expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
      const nameLen = zip.readUInt16LE(offset + 26);
      const extraLen = zip.readUInt16LE(offset + 28);
      const compSize = zip.readUInt32LE(offset + 18);
      const start = offset + 30 + nameLen + extraLen;
      const compressed = zip.subarray(start, start + compSize);
      const reconstructed = inflateRawSync(compressed);
      expect(reconstructed.toString("utf8")).toBe(expected.contents);
      offset = start + compSize;
    }
  });

  it("حتمية بايت-بايت: نفس المدخلات مرتان = نفس الأرشيف المضغوط", () => {
    expect(Buffer.compare(buildDeflatedZip(entries), buildDeflatedZip([...entries]))).toBe(0);
  });

  it.skipIf(process.platform !== "win32")("تكامل مع tar.exe للمضغوط (تخطٍّ موثق على لينكس — GNU tar لا يقرأ ZIP)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ab-zip-def-"));
    try {
      writeFileSync(join(dir, "def.zip"), buildDeflatedZip([{ path: "a.txt", contents: "hello".repeat(100) }]));
      const { stdout } = await run(tarExe(), ["-tf", "def.zip"], { cwd: dir, timeout: 15000 });
      expect(stdout).toContain("a.txt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
