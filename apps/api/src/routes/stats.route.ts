/**
 * مسار إحصاءات المستأجر — يغذي بطاقات النظرة العامة في اللوحة.
 * نطاقه من الترويسة الموثقة حصراً؛ الأرقام كلها مشتقة من صفوف L2.
 */

import type { FastifyInstance } from "fastify";
import { requirePermission } from "../plugins/auth.plugin.js";
import type { ApiContainer } from "../container.js";

const ACTIVE_STATUSES = new Set(["running", "suspended"]);

export function registerStatsRoutes(app: FastifyInstance, container: ApiContainer): void {
  app.get("/stats", async (request) => {
    const tenantId = requirePermission(request, "analytics:read").tenantId;
    const [pipelines, certificates] = await Promise.all([
      container.semantic.listPipelines(tenantId),
      container.semantic.listCertificates(tenantId),
    ]);

    const granted = certificates.filter((record) => record.granted);
    const lastRunAt = pipelines.reduce<string | null>(
      (latest, pipeline) => (latest === null || pipeline.createdAt > latest ? pipeline.createdAt : latest),
      null,
    );
    return {
      totalRuns: pipelines.length,
      activeRuns: pipelines.filter((pipeline) => ACTIVE_STATUSES.has(pipeline.status)).length,
      grantedCertificates: granted.length,
      avgFinalScore:
        granted.length > 0
          ? Math.round(granted.reduce((total, record) => total + record.finalScore, 0) / granted.length)
          : null,
      lastRunAt,
    };
  });
}
