/**
 * اختبارات آمنة على المضيف فقط — تُشغَّل ضمن pnpm -r test.
 *
 * القاعدة: أي اختبار يقلع عملية خادم حقيقية أو يلامس
 * fixtures مقصود الثغرة يُنفَّذ داخل الحاوية المقيدة حصراً (يُختار
 * بصرياً في vitest.sandbox.config.ts)، فلا يُنفَّذ على مضيف التطوير
 * مباشرة ولا ضمن الاختبار الشامل الافتراضي.
 *
 * ملاحظة التوافق: test.include يبقى كل spec، والاستثناء يُطبق عبر
 * exclude — أي ملف جديد آمن يُلتقط تلقائياً دون تسجيله هنا.
 */
import { defineConfig } from "vitest/config";

const SANDBOX_ONLY = [
  "src/vulnerable-server.spec.ts",
  // فحوص HD الحية تقلع خادم MCP حقيقياً عبر tsx على المضيف — نفس مستوى
  // الخطر الذي استدعى تصنيف اختبار الثغرات sandbox-only.
  "src/live-probes.spec.ts",
];

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    exclude: [...SANDBOX_ONLY, "**/node_modules/**"],
    testTimeout: 30000,
    coverage: {
      reporter: ["text"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.spec.ts",
        "src/index.ts",
        // مصادر تُنفَّذ فروعها عبر فحوص الحاوية فقط (فحوص HD الحية وfixture
        // الثغرات) — تُقاس داخل vitest.sandbox.config.ts، وerrors.ts مصنع
        // أخطاء لا يُستدعى إلا عند فشل حي صلب (سابقة استثناء infra الموثقة).
        "src/live-probes.ts",
        "src/mock-oidc-provider.ts",
        "src/mock-upstream.ts",
        "src/errors.ts",
        "src/security-tests.ts",
      ],
      // بوابات جناح المضيف: عتبة الفروع 75 — أدنى من بقية المقاييس لأن
      // الفحوص الحية تُقاس في جناح الحاوية. القياس صادق: فروع هذا الجناح
      // وحده تُقاس هنا، وإن نقص العتبة يفشل الشوط بصراحة ولا يُقبل
      // "اتحاد جناحين" كحدٍّ غير مقيس.
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
