/**
 * إعدادات Vitest لحزمة llm مع بوابة تغطية ≥ 80% مفروضة (القاعدة 13).
 * provider.ts يستثنى: عقد أنواع خالص بلا أسطر تنفيذية.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    coverage: {
      reporter: ["text"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/index.ts", "src/provider.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
