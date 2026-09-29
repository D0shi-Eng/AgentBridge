/**
 * اختبارات كاتب ZIP — متجهات CRC، البنية الداخلية، الحتمية، والقراءة العكسية.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { buildStoredZip, crc32 } from "./zip-writer.js";

const run = promisify(execFile);

/**
 * أداة القراءة للتكامل الحقيقي: tar.exe الرسمي من System32 على ويندوز
 * (bsdtar يقرأ ZIP؛ GNU tar من git-bash لا). المسار صريح دائماً لأن
 * PATHEXT داخل بيئة MSYS قد يعيد GNU tar الذي لا يفهم صيغة ZIP.
 */
function tarExe(): string {
  return process.platform === "win32" ? "C:/Windows/System32/tar.exe" : "tar";
}

describe("crc32", () => {
  it("المتجه المرجعي العالمي: 123456789 → 0xCBF43926", () => {
    expect(crc32(Buffer.from("123456789", "utf8"))).toBe(0xcbf43926);
  });

  it("نص عربي وسلسلة فارغة بقيم مستقرة لا سالبة", () => {
    expect(crc32(Buffer.from("عيادات", "utf8"))).toBeLessThanOrEqual(0xffffffff);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe("buildStoredZip", () => {
  const entries = [
    { path: "src/server.ts", contents: "console.log('مرحبا');\n" },
    { path: "manifest.json", contents: '{"tools":[]}' },
  ];

  it("الترويسة المحلية الأولى بتوقيع PK\\x03\\x04 والطول مطابق للمحتوى", () => {
    const zip = buildStoredZip(entries);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const nameLen = zip.readUInt16LE(26);
    expect(zip.toString("utf8", 30, 30 + nameLen)).toBe("src/server.ts");
    const size = zip.readUInt32LE(18);
    const content = zip.toString("utf8", 30 + nameLen, 30 + nameLen + size);
    expect(content).toBe(entries[0]?.contents);
  });

  it("الدليل المركزي يحوي عدد المدخلات وEOCD في النهاية", () => {
    const zip = buildStoredZip(entries);
    // EOCD آخر 22 بايت
    const eocdOffset = zip.length - 22;
    expect(zip.readUInt32LE(eocdOffset)).toBe(0x06054b50);
    expect(zip.readUInt16LE(eocdOffset + 8)).toBe(2); // entries on disk
    expect(zip.readUInt16LE(eocdOffset + 10)).toBe(2); // total entries
    const cdSize = zip.readUInt32LE(eocdOffset + 12);
    const cdOffset = zip.readUInt32LE(eocdOffset + 16);
    expect(cdOffset + cdSize).toBe(eocdOffset);
    expect(zip.readUInt32LE(cdOffset)).toBe(0x02014b50);
  });

  it("استخلاص عكسي كامل بتحليل الترويسات يعيد النصوص الأصلية حرفياً", () => {
    const zip = buildStoredZip(entries);
    let offset = 0;
    for (const expected of entries) {
      expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
      const nameLen = zip.readUInt16LE(offset + 26);
      const extraLen = zip.readUInt16LE(offset + 28);
      const size = zip.readUInt32LE(offset + 18);
      const crcStored = zip.readUInt32LE(offset + 14);
      const start = offset + 30 + nameLen + extraLen;
      const data = zip.subarray(start, start + size);
      expect(data.toString("utf8")).toBe(expected.contents);
      expect(crc32(data)).toBe(crcStored);
      offset = start + size;
    }
  });

  it("حتمية بايت-بايت: نفس المدخلات مرتان = نفس الأرشيف", () => {
    expect(Buffer.compare(buildStoredZip(entries), buildStoredZip([...entries]))).toBe(0);
  });

  it("أرشيف فارغ = EOCD وحده بطول 22", () => {
    const empty = buildStoredZip([]);
    expect(empty.length).toBe(22);
    expect(empty.readUInt16LE(8)).toBe(0);
  });

  it("الحراس: مسار مكرر ومسارات هروب تُرفض", () => {
    expect(() =>
      buildStoredZip([
        { path: "a.txt", contents: "1" },
        { path: "a.txt", contents: "2" },
      ]),
    ).toThrow(/مكرر/);
    expect(() => buildStoredZip([{ path: "../evil.txt", contents: "x" }])).toThrow(/غير صالح/);
    expect(() => buildStoredZip([{ path: "/abs.txt", contents: "x" }])).toThrow(/غير صالح/);
  });

  it.skipIf(process.platform !== "win32")("تكامل فعلي مع tar.exe على ويندوز: يسرد ملفات الأرشيف الثلاثة (تخطٍّ موثق على لينكس — GNU tar لا يقرأ ZIP)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ab-zip-"));
    try {
      const zipPath = join(dir, "pkg.zip");
      writeFileSync(
        zipPath,
        buildStoredZip([...entries, { path: "README.md", contents: "# الخادم المولد\n" }]),
      );
      const { stdout } = await run(tarExe(), ["-tf", "pkg.zip"], { cwd: dir, timeout: 15000 });
      for (const name of ["src/server.ts", "manifest.json", "README.md"]) {
        expect(stdout).toContain(name);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  afterAll(() => {
    // لا موارد دائمة — المجلدات المؤقتة تُمسح في كل اختبار
  });
});
