/**
 * Vitest لاختبارات الطيور e2e — تكامل حقيقي عبر حزم كاملة بلا عتبة تغطية
 * (هذه حزمة اختبارات لا مكتبة؛ التغطية مفروضة على الحزم النواة نفسها).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.spec.ts"],
    testTimeout: 120_000,
  },
});
