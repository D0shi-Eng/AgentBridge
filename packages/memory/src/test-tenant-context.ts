/** سياق خدمة اصطناعي لاختبارات العزل؛ لا مفاتيح ولا هوية مستخدم حقيقية. */
import type { TenantContext } from "@agentbridge/shared";

export function testContext(tenantId: string): TenantContext {
  return {
    tenantId,
    principal: {
      actorType: "service", authMethod: "api_key", subjectId: `test:${tenantId}`,
      credentialId: `test:${tenantId}`, tenantId,
      permissions: ["resource:read", "flywheel:read", "flywheel:write", "analytics:read"],
      authorizationVersion: 1,
    },
  };
}
