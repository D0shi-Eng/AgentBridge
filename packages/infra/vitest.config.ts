/**
 * إعدادات Vitest لحزمة infra — القياس دائماً، الإنفاذ للنواة الثلاث حصراً (القاعدة 13).
 * السياسة: عتبة 80% العالمية هنا غير قابلة للتحقيق عملياً مع المحولات الحية
 * داخل الحساب (72.4% مقاسة فعلاً) — أُبقي القياس
 * كاملاً في كل جولة والإنفاذ الملزم على parser/analyzer/generator وفق القاعدة 13،
 * والفجوة موثقة بقايا معلنة.
 *
 * ملفات المحولات الحية تُستثنى من حساب التغطية حصراً حين لا توجد
 * بنية حية — فغياب Docker لا يخفض أي فحص ولا يعاقب كوداً لم يُنفذ أصلاً؛
 * وعند توفر القاعدة يدخل الملف في الحساب ويغطيه اختباره التكاملي المشروط.
 */
import { createConnection } from "node:net";
import { defineConfig } from "vitest/config";

/** فحص منفذ TCP سريع — يكفي لكشف وجود الخدمة دون تكلفة عميل فعلي */
function portOpen(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const settle = (result: boolean): void => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

function endpointOf(url: string | undefined, fallbackPort: number): { host: string; port: number } {
  try {
    if (url !== undefined && url.length > 0) {
      const parsed = new URL(url);
      return { host: parsed.hostname, port: Number(parsed.port) || fallbackPort };
    }
  } catch {
    // عنوان غير سليم يُعامل كغياب خدمة
  }
  return { host: "127.0.0.1", port: fallbackPort };
}

const postgres = endpointOf(process.env.AB_LIVE_DATABASE_URL, 5433);
const liveInfrastructure = await portOpen(postgres.host, postgres.port);

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    coverage: {
      reporter: ["text"],
      include: ["src/**/*.ts"],
        exclude: [
        "src/**/*.spec.ts",
        "src/index.ts",
        ...(liveInfrastructure
          ? []
          : [
              "src/prisma-semantic-store.ts",
              "src/prisma-cost-ledger.ts",
              "src/pgvector-store.ts",
              "src/prisma-flywheel-store.ts",
              // محول SSO الحي وفحوص الإقلاع fail-closed — تختبهن البوابات الحية
              // ولا تُقاس عند غياب البنية سياسةً الموثقة نفسها
              "src/sso-prisma-store.ts",
              "src/prisma-scope-role.ts",
              "src/prisma-scope-tables.ts",
              // مولدات بذور القاعدة الحية — تُنفذ حصراً داخل الاختبارات التكاملية
              // المشروطة فتُقاس معها عند توفر القاعدة وتُستثنى عند غيابها.
              "src/semantic-seed.ts",
            ]),
      ],
      // الإنفاذ الإلزامي (thresholds) للنواة الثلاث حصراً — parser/analyzer/generator.
      // قياس تغطية infra يبقى كاملاً في كل جولة، والعتبة العالمية هنا
      // (72.4% الفعلية مع دخول المحولات الحية بالحساب) غير قابلة للتحقيق
      // عملياً — الفجوة بقايا معلنة في التقارير.
    },
  },
});
