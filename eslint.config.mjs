/**
 * إعدادات ESLint الموحدة للمونوريبو (صيغة flat config لـ ESLint 9).
 *
 * الفلسفة: قواعد صارمة قليلة تُطبَّق فعلاً، لا جدار قواعد يخنق الإنتاجية.
 * - recommended من typescript-eslint يلتقط الأخطاء الشائعة.
 * - منع any الصريح تطبيقاً للقاعدة 14 من ذاكرة المشروع.
 * - الاستثناء الوحيد: ملفات الإعدادات نفسها.
 */
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/*.config.mjs", "tests/fixtures/**"] },
  {
    files: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts", "tests/e2e/**/*.ts"],
    extends: [...tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
