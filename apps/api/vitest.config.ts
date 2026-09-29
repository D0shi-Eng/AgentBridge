/**
 * إعدادات Vitest لتطبيق api — بوابة تغطية ≥ 80%.
 * main.ts يستثنى: إقلاع فعلي بمنافذ حقيقية، والاختبارات كلها عبر inject.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    testTimeout: 30000,
    coverage: {
      reporter: ["text"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/main.ts", "src/run-service-contracts.ts"],
      thresholds: { lines: 80, functions: 80, branches: 77, statements: 80 },
    },
  },
});
