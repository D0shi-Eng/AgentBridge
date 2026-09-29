/**
 * أدوات اختبار مشتركة لتطبيق api — بذر مستأجرين ومشاريع ومواصفات
 * وانتظار حالة التشغيل. كلها عبر fastify.inject بلا منافذ حقيقية.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { generateApiKey, hashApiKey } from "@agentbridge/infra";
import type { ApiContainer } from "./container.js";
import type { Permission } from "@agentbridge/shared";

export const PETSTORE_YAML = readFileSync(
  fileURLToPath(new URL("../../../tests/fixtures/mini-petstore.yaml", import.meta.url)),
  "utf8",
);

export interface SeededTenant {
  readonly tenantId: string;
  readonly apiKey: string;
}

/** يبذر مستأجراً بمفتاح خام يعرض مرة واحدة (hash فقط في المخزن) */
export async function seedTenant(container: ApiContainer, tenantId: string, name: string, admin = false): Promise<SeededTenant> {
  const apiKey = generateApiKey();
  const keyHash = hashApiKey(apiKey);
  await container.semantic.createTenant({
    tenantId,
    name,
    apiKeyHash: keyHash,
    createdAt: new Date().toISOString(),
  });
  const base: Permission[] = ["resource:read", "pipeline:run", "pipeline:review", "artifact:read", "flywheel:read", "flywheel:write", "analytics:read"];
  await container.authStore.putApiCredential({
    credentialId: `legacy:${tenantId}`, tenantId, subjectId: `service:${tenantId}`,
    keyHash, permissions: admin ? [...base, "sso:manage", "tenant:admin"] : base,
    authorizationVersion: 1,
  });
  await container.authStore.putExternalIdentity({ identityId: `identity:${tenantId}`, issuer: "urn:agentbridge:legacy-api-key", subject: `service:${tenantId}`, createdAt: new Date().toISOString() });
  await container.authStore.putMembership({ membershipId: `membership:${tenantId}`, identityId: `identity:${tenantId}`, tenantId, role: admin ? "tenant_admin" : "reviewer", status: "active", authorizationVersion: 1 });
  return { tenantId, apiKey };
}

export function authHeader(tenant: SeededTenant): Record<string, string> {
  return { authorization: `Bearer ${tenant.tenantId}:${tenant.apiKey}` };
}

/** مصفوفة set-cookie بصيغة الاختبارات — جلسة صادرة من SessionService مباشرة */
export function setSessionCookieForTest(rawToken: string, csrfToken: string): string[] {
  return [
    `ab_session_dev=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; SameSite=Lax`,
    `ab_csrf=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Lax`,
  ];
}

export async function createProject(
  app: FastifyInstance,
  tenant: SeededTenant,
  name = "مشروع افتراضي",
): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/projects", headers: authHeader(tenant), payload: { name } });
  if (response.statusCode !== 201) throw new Error(`فشل بذر مشروع: ${response.body}`);
  return (JSON.parse(response.body) as { projectId: string }).projectId;
}

export async function uploadSpec(app: FastifyInstance, tenant: SeededTenant, projectId: string, content = PETSTORE_YAML): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/specs", headers: authHeader(tenant), payload: { projectId, content } });
  if (response.statusCode !== 201) throw new Error(`فشل بذر مواصفة: ${response.body}`);
  return (JSON.parse(response.body) as { specId: string }).specId;
}

/** يشغل أنبوباً كاملاً ويعيد runId بعد قبول 202 */
export async function startPipeline(app: FastifyInstance, tenant: SeededTenant, projectId: string, specId: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/pipelines",
    headers: authHeader(tenant),
    payload: { projectId, specId },
  });
  if (response.statusCode !== 202) throw new Error(`لم يُقبل التشغيل: ${response.body}`);
  return (JSON.parse(response.body) as { runId: string }).runId;
}

export async function waitForStatus(
  app: FastifyInstance,
  tenant: SeededTenant,
  runId: string,
  terminal: readonly string[],
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: `/pipelines/${runId}/status`, headers: authHeader(tenant) });
    const status = (JSON.parse(response.body) as { status?: string }).status;
    if (status !== undefined && terminal.includes(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`انتهت مهلة انتظار حالة من [${terminal.join("،")}] للتشغيل ${runId}`);
}
