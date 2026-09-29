/**
 * اختبارات الفاحص الدلالي للحدود — الكوربس السلبي المرجعي الكامل
 * (إغلاق نهائي بحد ثقة موثق).
 *
 * كل حالة تُبنى نصاً وتُفحص ساكنة فقط — لا تنفيذ أي payload على المضيف
 * (حد الفاحص بنيوي-دلالي؛ التنفيذ الفعلي حصراً داخل sandbox الحي).
 * العائلات الملزمة: aliases، خصائص محسوبة، وصول متداخل، import ديناميكي،
 * استدعاء غير مباشر، تفكيك، قوالب نصية، معرفات مرمزة، prototype، إعادة
 * تصدير، ظل معرفات، عقد غير متوقعة، هروب allowlist، syntax تالف، ورفض تحفظي.
 */

import { describe, expect, it } from "vitest";
import { checkAstBoundaries } from "./ast-scope-checker.js";

const files = (contents: string) => new Map([["src/tools.ts", contents]]);
const rejected = (result: { passed: boolean }) => !result.passed;

describe("corpus الفاحص الدلالي — عائلات الهروب تُمسك كلها", () => {
  it("aliases: نسخ eval إلى معرف ثم استدعاؤه", () => {
    expect(rejected(checkAstBoundaries(files('const e = eval; e("1+1");')))).toBe(true);
  });

  it("خصائص محسوبة: دمج نصين لبناء اسم ممنوع", () => {
    expect(rejected(checkAstBoundaries(files('const f = globalThis["ev" + "al"];')))).toBe(true);
  });

  it("قالب نصي كمفتاح محسوب: [`ev${x}al`]", () => {
    expect(rejected(checkAstBoundaries(files("const f = globalThis[`ev${x}al`];")))).toBe(true);
  });

  it("وصول متداخل: process.binding عبر سلسلة أعضاء", () => {
    expect(rejected(checkAstBoundaries(files("const p = process.binding(\"fs\");")))).toBe(true);
  });

  it("استيراد ديناميكي بمسار مركب: import()", () => {
    expect(rejected(checkAstBoundaries(files('const m = await import("./" + name);')))).toBe(true);
  });

  it("استدعاء غير مباشر: Reflect.apply(eval, …)", () => {
    expect(rejected(checkAstBoundaries(files("const r = Reflect.apply(eval, null, [\"1\"]);")))).toBe(true);
  });

  it("تفكيك مصدر ممنوع: const { exec } = require(...)", () => {
    expect(rejected(checkAstBoundaries(files('const { exec } = require("child_process");')))).toBe(true);
  });

  it("سلسلة prototype: constructor.constructor كبناء دالة", () => {
    expect(rejected(checkAstBoundaries(files("const g = ({}).constructor.constructor(\"return 1\");")))).toBe(true);
  });

  it("إعادة تصدير وحدة ممنوعة: export * from", () => {
    expect(rejected(checkAstBoundaries(files('export * from "node:child_process";')))).toBe(true);
  });

  it("إعادة تصدير مسمى لوحدة ممنوعة", () => {
    expect(rejected(checkAstBoundaries(files('export { spawn } from "child_process";')))).toBe(true);
  });

  it("ظل معرفات: إعلان const باسم ممنوع يرفض تحفظياً", () => {
    expect(rejected(checkAstBoundaries(files("const eval = 1;")))).toBe(true);
  });

  it("تمرير غير مباشر: require كوسيط دالة", () => {
    expect(rejected(checkAstBoundaries(files("const w = wrap(require);")))).toBe(true);
  });

  it("new Function بأي سياق", () => {
    expect(rejected(checkAstBoundaries(files('const g = new Function("return process.env");')))).toBe(true);
  });

  it("syntax تالف: رفض مغلق للملف كله (لا منطقة معتمة)", () => {
    const result = checkAstBoundaries(files("const x = ; function { broken"));
    expect(rejected(result)).toBe(true);
    expect(result.detail).toContain("malformed-syntax");
  });
});

describe("corpus الفاحص الدلالي — الإيجابي الصادق لا يُرفض", () => {
  it("معرف مرمز يونيكود يُطبَّع فيسمك (\\u0065val)", () => {
    expect(rejected(checkAstBoundaries(files('const x = \\u0065val("1");')))).toBe(true);
  });

  it("خادم مولد نموذجي بلا أي انتهاك يمر", () => {
    const sound = [
      'import { registerTool } from "@modelcontextprotocol/sdk/server/mcp.js";',
      'const res = await fetch(config.upstreamBaseUrl + "/pets");',
      "if (res.length > 524288) throw new Error('too large');",
      "const parsed = JSON.parse(text);",
      "const pet = record[\"petId\"];",
      "const key = params[petId];",
    ].join("\n");
    expect(checkAstBoundaries(files(sound)).passed).toBe(true);
  });

  it("كلمة خطرة في تعليق أو نص لا تنتج إيجاباً كاذباً", () => {
    const benign = [
      "// لا تستخدم eval هنا — توثيق فقط",
      'const warning = "never call require from here";',
      "export const n = 1;",
    ].join("\n");
    expect(checkAstBoundaries(files(benign)).passed).toBe(true);
  });

  it("فهرسة محسوبة بممثل بسيط تبقى مشروعة (وصول خرائط)", () => {
    expect(checkAstBoundaries(files("const v = headers[key];")).passed).toBe(true);
  });

  it("خريطة فارغة = فشل صريح لا نجاح فراغي", () => {
    const result = checkAstBoundaries(new Map());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("لا ملفات");
  });
});
