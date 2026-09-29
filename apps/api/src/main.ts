/**
 * نقطة الإقلاع الفعلية — رقيقة عمداً: كل المنطق قابل للاختبار عبر buildApp.
 * فشل config هنا = رفض إقلاع برسالة عربية ورمز خروج 1 (وثيقة security.md §1).
 */

import { loadConfig } from "@agentbridge/infra";
import { buildApp } from "./app.js";
import { buildContainer } from "./container.js";

const configResult = loadConfig(process.env as Record<string, string | undefined>);
if (!configResult.ok) {
  console.error(configResult.error.message);
  process.exit(1);
}

// async: نمط live يفحص الدور المقيد fail-closed عند الإقلاع — top-level await
const container = await buildContainer({ env: process.env });
const app = buildApp(container);

const stopSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
for (const signal of stopSignals) {
  process.on(signal, () => {
    void app
      .close()
      .then(() => container.close?.())
      .then(() => process.exit(0));
  });
}

await app.listen({ port: container.config.port, host: "127.0.0.1" });
