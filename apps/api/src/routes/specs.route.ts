/**
 * مسار المواصفات — رفع نص OpenAPI بحجم مقيّد ضمن مشروع يملكه المستأجر.
 * النص يُخزن كما ورد في L2؛ الفحص البنيوي التفصيلي عمل المرحلة الأولى
 * من مسار المعالجة لا عمل للرفع.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, Errors } from "@agentbridge/shared";
import { newRunId } from "@agentbridge/infra";
import { requirePermission } from "../plugins/auth.plugin.js";
import type { ApiContainer } from "../container.js";

/** حد حجم المواصفة بالبايت — 512 كيلوبايت تكفي أكبر مواصفات العملاء */
export const MAX_SPEC_BYTES = 512 * 1024;

const UploadSpecBody = z.object({
  projectId: z.string().min(1),
  content: z.string().min(1),
});

export function registerSpecRoutes(app: FastifyInstance, container: ApiContainer): void {
  app.post("/specs", async (request, reply) => {
    const tenantId = requirePermission(request, "pipeline:run").tenantId;
    const parsed = UploadSpecBody.safeParse(request.body);
    if (!parsed.success) throw Errors.invalidInput("projectId وcontent حقول إلزامية");

    const project = await container.semantic.getProject(tenantId, parsed.data.projectId);
    if (project === null) throw new AppError("NOT_FOUND", "المشروع غير موجود");

    const bytes = Buffer.byteLength(parsed.data.content, "utf8");
    if (bytes > MAX_SPEC_BYTES) {
      throw new AppError("SPEC_TOO_LARGE", `حجم المواصفة ${bytes} بايت يتجاوز الحد ${MAX_SPEC_BYTES}`, false, "warning");
    }

    const specId = newRunId();
    await container.semantic.createSpec({
      specId,
      tenantId,
      projectId: project.projectId,
      content: parsed.data.content,
      createdAt: new Date().toISOString(),
    });
    return reply.code(201).send({ specId, projectId: project.projectId, bytes });
  });

  app.get("/specs/:specId", async (request) => {
    const tenantId = requirePermission(request, "resource:read").tenantId;
    const { specId } = request.params as { specId: string };
    const spec = await container.semantic.getSpec(tenantId, specId);
    if (spec === null) throw new AppError("NOT_FOUND", "المواصفة غير موجودة");
    return { specId: spec.specId, projectId: spec.projectId, createdAt: spec.createdAt, content: spec.content };
  });
}
