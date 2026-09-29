/**
 * مسار المشاريع — كل العمليات محصورة بمستأجر المصادقة تلقائياً.
 * معرف مشروع لا يعود لمستأجرك = غير موجود (404) لا ممنوع (403)
 * فلا يتسرب وجوده.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, Errors } from "@agentbridge/shared";
import { newRunId } from "@agentbridge/infra";
import { requirePermission } from "../plugins/auth.plugin.js";
import type { ApiContainer } from "../container.js";

const CreateProjectBody = z.object({ name: z.string().min(1).max(200) });

export function registerProjectRoutes(app: FastifyInstance, container: ApiContainer): void {
  app.post("/projects", async (request, reply) => {
    const tenantId = requirePermission(request, "pipeline:run").tenantId;
    const parsed = CreateProjectBody.safeParse(request.body);
    if (!parsed.success) throw Errors.invalidInput("اسم المشروع مطلوب وبحد 200 حرف");

    const projectId = newRunId();
    await container.semantic.createProject({
      projectId,
      tenantId,
      name: parsed.data.name,
      createdAt: new Date().toISOString(),
    });
    return reply.code(201).send({ projectId, name: parsed.data.name });
  });

  app.get("/projects", async (request) => {
    const projects = await container.semantic.listProjects(requirePermission(request, "resource:read").tenantId);
    return { projects: projects.map((project) => ({ projectId: project.projectId, name: project.name })) };
  });

  app.get("/projects/:projectId", async (request) => {
    const tenantId = requirePermission(request, "resource:read").tenantId;
    const { projectId } = request.params as { projectId: string };
    const project = await container.semantic.getProject(tenantId, projectId);
    if (project === null) {
      throw new AppError("NOT_FOUND", "المشروع غير موجود");
    }
    return { projectId: project.projectId, name: project.name, createdAt: project.createdAt };
  });
}
