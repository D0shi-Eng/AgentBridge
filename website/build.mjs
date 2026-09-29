/**
 * بنّاء الموقع الثابت — يجمّع نسخة قابلة للنشر لاحقًا في website/dist:
 * - ينسخ صفحات الموقع وأصوله.
 * - ينسخ شجرة docs اللازمة (الشعار + رسومات التوصيل SVG) بنفس البنية النسبية
 *   حتى تبقى كل المراجع النسبية صحيحة دون أي تعديل على الصفحات.
 * هذا البناء محلي فقط — لا يوجد أي workflow نشر، وقرار النشر نفسه للمالك.
 * الاستخدام: node website/build.mjs   → website/dist/
 */
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(HERE, "dist");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// الصفحات والأصول بنفس المسارات النسبية الحالية
cpSync(join(HERE, "index.html"), join(DIST, "website", "index.html"), { recursive: true });
mkdirSync(join(DIST, "website", "en"), { recursive: true });
cpSync(join(HERE, "en", "index.html"), join(DIST, "website", "en", "index.html"));
cpSync(join(HERE, "404.html"), join(DIST, "website", "404.html"));
cpSync(join(HERE, "assets"), join(DIST, "website", "assets"), { recursive: true });

// شجرة docs المطلوبة للروابط النسبية: الشعار + SVG الرسومات
cpSync(join(ROOT, "docs", "assets"), join(DIST, "docs", "assets"), { recursive: true });
cpSync(join(ROOT, "docs", "architecture", "diagrams", "svg"), join(DIST, "docs", "architecture", "diagrams", "svg"), { recursive: true });

// صفحة 404 للمضيفات التي تدعمها (GitHub Pages تعتمد 404.html من الجذر)
cpSync(join(HERE, "404.html"), join(DIST, "404.html"));

if (!existsSync(join(DIST, "website", "index.html"))) {
  console.error("WEBSITE_BUILD_FAIL");
  process.exit(1);
}
console.log("WEBSITE_BUILD_OK → website/dist (نسخة ثابتة قابلة للنشر لاحقًا بقرار المالك)");
