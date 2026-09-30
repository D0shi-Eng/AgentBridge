/**
 * مدقق تكافؤ README ثنائي اللغة — حزمة جاهزية المستودع الخاص.
 *
 * ماهيتها: فحص حتمي أن README.md (إنجليزي) وREADME.ar.md (عربي)
 * متكافئان بنيوياً: الأقسام الإلزامية موجودة وبالترتيب نفسه
 * في النسختين، وأزرار تنقّل اللغة موجودة أعلى كل ملف.
 * وظيفتها: بوابة CI تمنع انحراف النسختين عند التعديل.
 * كيف تعمل: قائمة أزواج عناوين مرتبة (إنجليزي، عربي) — يتطلب وجود
 * كل عنوان في ملفه بترتيب تصاعدي بلا تداخل.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");

/** الأقسام الإلزامية — (العنوان الإنجليزي، العنوان العربي) بالترتيب */
const SECTIONS = [
  ["What is AgentBridge?", "ما هو AgentBridge؟"],
  ["Product Type: a Self-Hosted Web Platform", "نوع المنتج: منصة ويب ذاتية الاستضافة"],
  ["The Problem It Solves", "المشكلة التي يحلها"],
  ["Workflow: From OpenAPI to MCP", "سير العمل: من OpenAPI إلى MCP"],
  ["What You Can Do", "ماذا يمكنك فعله؟"],
  ["Architecture", "المعمارية"],
  ["Security Model and Limits", "نموذج الأمان وحدوده"],
  ["Getting Started Locally", "البدء محلياً"],
  ["Try the CLI — no keys, no services", "جرّب سطر الأوامر — بلا مفاتيح وبلا خدمات"],
  ["Operating the Local Platform", "تشغيل المنصة محليًا وصيانتها"],
  ["Optional Live Integration Tests", "اختبارات التكامل الحية الاختيارية"],
  ["Repository Layout", "بنية المستودع"],
  ["Configuration Variables", "متغيرات الإعداد"],
  ["Testing and Verification", "الاختبارات والتحقق"],
  ["Contributing and Security Reporting", "المساهمة والإبلاغ الأمني"],
  ["Operating Boundaries", "حدود التشغيل"],
  ["License", "الترخيص"],
];

function extractHeadings(markdown) {
  return markdown
    .split("\n")
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, "").trim());
}

function indexOfOrdered(headings, wanted) {
  let cursor = 0;
  const positions = [];
  for (const title of wanted) {
    const at = headings.findIndex((h, i) => i >= cursor && h === title);
    if (at === -1) return { ok: false, missing: title };
    positions.push(at);
    cursor = at + 1;
  }
  return { ok: true, positions };
}

const failures = [];
for (const [file, wanted] of [
  ["README.md", SECTIONS.map((s) => s[0])],
  ["README.ar.md", SECTIONS.map((s) => s[1])],
]) {
  const content = await fs.readFile(path.join(root, file), "utf8").catch(() => null);
  if (content === null) {
    failures.push(`${file}: مفقود`);
    continue;
  }
  // زر تنقّل اللغة أعلى الملفين
  const hasSwitch = /\[<kbd>English<\/kbd>\]\(README\.md\)[\s\S]*\[<kbd>العربية<\/kbd>\]\(README\.ar\.md\)/.test(content);
  if (!hasSwitch) failures.push(`${file}: أزرار تنقّل اللغة مفقودة أو غير مطابقة`);
  const result = indexOfOrdered(extractHeadings(content), wanted);
  if (!result.ok) failures.push(`${file}: القسم «${result.missing}» مفقود أو خارج الترتيب`);
}

console.log(JSON.stringify({ sectionsRequired: SECTIONS.length, failures }, null, 2));
process.exit(failures.length > 0 ? 1 : 0);
