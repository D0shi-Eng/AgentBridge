/**
 * إعدادات Vitest لحزمة الاستيعاب مع بوابة تغطية إلزامية.
 *
 * القاعدة 13 من ذاكرة المشروع: تغطية ≥ 80% للحزم النواة.
 * جعلناها عتبة فشل في الإعدادات حتى لا تنخفض التغطية بصمت مستقبلاً.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    coverage: {
      reporter: ["text"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/index.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
