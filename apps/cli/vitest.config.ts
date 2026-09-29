/**
 * إعدادات Vitest لتطبيق CLI — اختبار دخان واحد على التركيبة المرجعية.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    testTimeout: 30000,
  },
});
