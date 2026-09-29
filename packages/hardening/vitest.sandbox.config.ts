/**
 * تشغيل اختبارات الحاوية المقيدة فقط — sandbox-only.
 *
 * المحتوى: vulnerable-server.spec.ts الذي يقلع خادم الثغرات الحقيقي
 * عبر tsx داخل الحاوية المقيدة (infra/hardening/sandbox.ts) حصراً.
 *
 * التشغيل الداخلي للحاوية (من جذر المستودع):
 *   docker compose -f docker-compose.sandbox.yaml run --rm hardening-sandbox
 * يقرأ docker-compose.sandbox.yaml هذا الملف عبر SANDBOX_VITEST_CONFIG.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/vulnerable-server.spec.ts", "src/live-probes.spec.ts"],
    testTimeout: 60000,
    coverage: {
      reporter: ["text"],
      include: ["src/live-probes.ts", "src/mock-oidc-provider.ts", "src/mock-upstream.ts", "src/security-tests.ts"],
      // بوابات جناح الحاوية: فروع الحياة الفعلية (تدمير اتصالات/مسارات فشل
      // upstream) وحدها تُقاس هنا — بوابات صادقة لما ينفذه هذا الجناح حصراً.
      thresholds: { lines: 80, functions: 75, branches: 62, statements: 80 },
    },
  },
});
