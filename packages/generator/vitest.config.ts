/**
 * إعدادات Vitest لحزمة generator مع بوابة تغطية ≥ 80% مفروضة (القاعدة 13).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    // اختبار القبول e2e يقلع عمليات حقيقية فيحتاج مهلة أوسع
    testTimeout: 30000,
    coverage: {
      reporter: ["text"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.spec.ts",
        "src/index.ts",
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
