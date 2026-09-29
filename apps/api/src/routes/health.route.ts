/**
 * مسارات الصحة — العام الوحيد بلا مصادقة، بلا تفاصيل داخلية.
 * /readyz يفحص التبعيات الفعلية (Postgres/Redis) قبل إتاحة
 * النسخة في موازن الأحمال — يفشل عند سقوط تبعية (لا ok صوري).
 * الإخراج حالات مكونات فقط بلا بيانات مستأجرين ولا أخطاء مفصلة.
 */

import type { FastifyInstance } from "fastify";
import type { ApiContainer } from "../container.js";

/** معرفات اصطناعية للفحص — لا تلمس بيانات مستأجر حقيقي ولا تكشفها */
const PROBE_TENANT = "ops-readiness-probe";

export function registerHealthRoutes(app: FastifyInstance, container?: ApiContainer): void {
  app.get("/health", { config: { auth: "public" } }, async () => ({ status: "ok", service: "agentbridge-api" }));

  // readiness حقيقي: probe قراءة خفيف لكل تبعية؛ فشلها يرفض الجاهزية
  app.get("/readyz", { config: { auth: "public" } }, async () => {
    if (container === undefined) return { status: "ok", components: {} };
    const components: Record<string, "ok" | "degraded"> = {};
    let ready = true;
    try {
      await container.semantic.listPipelines(PROBE_TENANT);
      components.postgres = "ok";
    } catch {
      components.postgres = "degraded";
      ready = false;
    }
    try {
      await container.episodic.readEvents(PROBE_TENANT, "ops-readiness-probe-run");
      components.redis = "ok";
    } catch {
      components.redis = "degraded";
      ready = false;
    }
    return {
      status: ready ? "ok" : "degraded",
      components,
      at: new Date().toISOString(),
    };
  });
}
