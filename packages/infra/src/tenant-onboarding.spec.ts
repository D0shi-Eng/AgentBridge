/**
 * اختبارات onboarding الإنتاجي — الناجح، والرفض fail-closed لكل
 * مسار مكرر أو مخالف، ووعد التدقيق بلا أي أثر للمفتاح الخام.
 */

import { describe, expect, it } from "vitest";
import { createInMemoryAuthStore, createInMemorySemanticStore } from "@agentbridge/memory";
import { HashChainAuditLog } from "./audit-chain.js";
import {
  OnboardingError, onboardTenantMemoryAtomic,
  validateOnboardingInput, type OnboardingAuditSink, type OnboardingInput, type OnboardingResult, type OnboardingSecret,
} from "./tenant-onboarding.js";
import { verifyApiKeyAsync } from "./crypto.js";

/** بناء بيئة اختبار متكاملة: مخزنان داخليان وسجل تدقيق ملتقط */
function buildDeps() {
  const semantic = createInMemorySemanticStore();
  const auth = createInMemoryAuthStore();
  const auditChain = new HashChainAuditLog(semantic);
  const audit: OnboardingAuditSink = {
    async record(input) {
      return auditChain.record(input);
    },
  };
  return {
    semantic, auth, audit,
    deps: {
      semantic, auth, lifecycle: semantic,
      deleteTenant: (id: string) => semantic.deleteTenant(id),
      deleteExternalIdentityById: (id: string) => auth.deleteExternalIdentityById(id),
      deleteMembership: (id: string) => auth.deleteMembership(id),
      deleteApiCredential: (id: string) => auth.deleteApiCredential(id),
    },
  };
}

const BASE: OnboardingInput = {
  tenantId: "clinica-alpha",
  tenantName: "عيادة ألفا التجريبية",
  ownerIssuer: "https://idp.example.test",
  ownerSubject: "owner-1",
  credentialPermissions: ["resource:read", "pipeline:run", "artifact:read"],
  expiresInDays: 30,
  nowIso: "2026-09-20T12:00:00.000Z",
};

type Onboarded = OnboardingResult & OnboardingSecret;

/** يشغل onboarding عبر المسار الذري الداخلي — نفس مسار الإنتاج تماماً */
async function onboard(ctx: ReturnType<typeof buildDeps>, input: OnboardingInput): Promise<Onboarded> {
  return onboardTenantMemoryAtomic(ctx.deps, ctx.audit, input);
}

describe("FC — onboarding الإنتاجي للمستأجر", () => {
  it("ينشئ مستأجراً بمالك واعتماد محدود الصلاحية وموثق الانتهاء", async () => {
    const ctx = buildDeps();
    const result = await onboard(ctx, { ...BASE, initial: true });
    expect(result.credentialId).toBe("bootstrap-clinica-alpha");
    expect(result.ownerRole).toBe("tenant_admin");
    expect(result.expiresAt).toBe("2026-10-20T12:00:00.000Z");
    const credential = await ctx.auth.findApiCredential(result.credentialId);
    expect(credential).not.toBeNull();
    expect(credential?.expiresAt).toBe(result.expiresAt);
    expect(await verifyApiKeyAsync(result.apiKey, credential?.keyHash ?? "")).toBe(true);
    const membership = await ctx.auth.findMembership(result.identityId, BASE.tenantId);
    expect(membership?.role).toBe("tenant_admin");
    expect(membership?.status).toBe("active");
    // hash المستأجر الخامد لا يساوي hash الاعتماد — إحياء legacy مستحيل
    const tenant = await ctx.semantic.getTenant(BASE.tenantId);
    expect(tenant?.apiKeyHash).not.toBe(credential?.keyHash);
  });

  it("يخزن hash فقط: المفتاح الخام غائب عن سجل المستأجر والاعتماد", async () => {
    const ctx = buildDeps();
    const result = await onboard(ctx, BASE);
    const serialized = JSON.stringify({
      tenant: await ctx.semantic.getTenant(BASE.tenantId),
      credential: await ctx.auth.findApiCredential(result.credentialId),
    });
    expect(serialized).not.toContain(result.apiKey);
  });

  it("يوثق onboarding في التدقيق بمعرف ارتباطي وبلا سر في الحمولة", async () => {
    const ctx = buildDeps();
    const result = await onboard(ctx, BASE);
    const entries = await ctx.semantic.listAuditEntries(BASE.tenantId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.stage).toBe("tenant_onboarding");
    expect(entries[0]?.runId).toBe(result.auditCorrelationId);
    expect(JSON.stringify(entries)).not.toContain(result.apiKey);
    expect(entries[0]?.abstractedPayload).toContain(result.credentialId);
  });

  it("يرفض مستأجراً مكرراً وهوية مالك مكررة بلا أي كتابة جديدة", async () => {
    const ctx = buildDeps();
    await onboard(ctx, BASE);
    await expect(onboard(ctx, BASE)).rejects.toMatchObject({ code: "TENANT_EXISTS" });
    await expect(onboard(ctx, { ...BASE, tenantId: "clinica-beta", ownerSubject: "owner-1" }))
      .rejects.toMatchObject({ code: "OWNER_EXISTS" });
    // لا مستأجر ثانٍ أُنشئ بعد الرفضين
    expect(await ctx.semantic.getTenant("clinica-beta")).toBeNull();
    expect(await ctx.semantic.listAuditEntries("clinica-beta")).toHaveLength(0);
  });

  it("حارس bootstrap الأول: ثاني --initial يرفض", async () => {
    const ctx = buildDeps();
    await onboard(ctx, { ...BASE, initial: true });
    expect(await ctx.semantic.countAdminTenants()).toBe(1);
    await expect(onboard(ctx, { ...BASE, tenantId: "clinica-beta", ownerSubject: "owner-2", initial: true }))
      .rejects.toMatchObject({ code: "BOOTSTRAP_DONE" });
  });

  it("يرفض النطاقات غير المعروفة وصلاحيات الإدارة الآلية والمدد غير المنطقية", () => {
    const bad = (patch: Partial<OnboardingInput>): OnboardingInput => ({ ...BASE, ...patch });
    expect(() => validateOnboardingInput(bad({ credentialPermissions: ["root:everything" as never] }))).toThrow(OnboardingError);
    expect(() => validateOnboardingInput(bad({ credentialPermissions: ["sso:manage" as never] }))).toThrow(OnboardingError);
    expect(() => validateOnboardingInput(bad({ credentialPermissions: ["tenant:admin" as never] }))).toThrow(OnboardingError);
    expect(() => validateOnboardingInput(bad({ expiresInDays: 0 }))).toThrow(OnboardingError);
    expect(() => validateOnboardingInput(bad({ expiresInDays: 731 }))).toThrow(OnboardingError);
    expect(() => validateOnboardingInput(bad({ tenantId: "Bad_ID" }))).toThrow(OnboardingError);
    expect(() => validateOnboardingInput(bad({ tenantName: "  " }))).toThrow(OnboardingError);
  });
});
