/**
 * Vitest للوحة التحكم — منطق lib + مكونات React (RTL/jest-dom) ببيئة jsdom
 * وتغطية dashboard/src ≥80% حرفياً (lines/functions/branches/statements 80).
 */
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      reporter: ["text"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.spec.*", "src/app/**"],
      thresholds: { lines: 80, functions: 75, branches: 80, statements: 80 },
    },
  },
});
