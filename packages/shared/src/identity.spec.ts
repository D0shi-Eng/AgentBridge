/**
 * إثبات بوابة TenantContext:
 * السياق لا يُبنى من tenantId خام — يجب أن يطابق Principal موثوقاً
 * ويتحقق زمن التشغيل قبل أي وصول إلى مخزن.
 */
import { describe, expect, it } from "vitest";
import { requireTenantContext, type Principal, type TenantContext } from "./identity.js";

function principalFor(tenantId: string): Principal {
  return {
    actorType: "service", authMethod: "api_key", subjectId: `svc:${tenantId}`,
    tenantId, credentialId: `cred:${tenantId}`,
    permissions: ["resource:read"], authorizationVersion: 1,
  };
}

describe("TenantContext — لا سياق من مدخل خام", () => {
  it("سياق صحيح: tenantId يطابق Principal فيُقبل ويعاد موثقاً", () => {
    const context: TenantContext = requireTenantContext({
      tenantId: "t-a", principal: principalFor("t-a"),
    });
    expect(context.tenantId).toBe("t-a");
    expect(context.principal.actorType).toBe("service");
  });

  it("سياق A مع Principal لمستأجر B ⇒ رفض TENANT_CONTEXT_INVALID", () => {
    expect(() => requireTenantContext({ tenantId: "t-a", principal: principalFor("t-b") }))
      .toThrow(/سياق المستأجر الموثوق مفقود أو متعارض/);
  });

  it("tenantId خام بلا Principal ⇒ رفض، وغياب السياق كله ⇒ رفض", () => {
    expect(() => requireTenantContext("t-a")).toThrow();
    expect(() => requireTenantContext({ tenantId: "t-a" })).toThrow();
    expect(() => requireTenantContext(null)).toThrow();
  });

  it("حقول Principal ناقصة أو غريبة ⇒ رفض (لا بناء جزئي للهوية)", () => {
    expect(() => requireTenantContext({ tenantId: "t-a", principal: { actorType: "service" } })).toThrow();
    expect(() => requireTenantContext({
      tenantId: "t-a", principal: { ...principalFor("t-a"), extra: 1 },
    })).toThrow();
  });
});
