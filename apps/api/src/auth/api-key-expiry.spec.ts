/**
 * اختبارات انتهاء صلاحية الاعتماد — المنقضي يفشل fail-closed،
 * والصالح يعمل، والملغى يظل مرفوضاً، ومفتاح مستأجر آخر لا يفتح شيئاً.
 */

import { describe, expect, it } from "vitest";
import { createInMemoryAuthStore, createInMemorySemanticStore } from "@agentbridge/memory";
import { onboardTenantInMemory, type OnboardingInput } from "@agentbridge/infra";
import { authenticateApiKey } from "./api-key-auth.js";

const NOW_ISO = "2030-01-15T12:00:00.000Z";

async function buildOnboarded(credentialId: string) {
  const semantic = createInMemorySemanticStore();
  const auth = createInMemoryAuthStore();
  const input: OnboardingInput = {
    tenantId: "expiry-check", tenantName: "فحص الصلاحية",
    ownerIssuer: "https://idp.example.test", ownerSubject: "owner-1",
    credentialPermissions: ["resource:read", "pipeline:run"],
    expiresInDays: 30, nowIso: NOW_ISO,
  };
  const result = await onboardTenantInMemory({ semantic, auth, lifecycle: semantic }, input);
  void credentialId;
  return { semantic, auth, result };
}

describe("انتهاء صلاحية اعتماد API", () => {
  it("اعتماد ضمن صلاحيته يصادق بنطاقاته المعلنة", async () => {
    const world = await buildOnboarded("bootstrap-expiry-check");
    const principal = await authenticateApiKey(
      world.auth, `Bearer bootstrap-expiry-check.${world.result.apiKey}`, world.semantic, new Date(NOW_ISO),
    );
    expect(principal?.tenantId).toBe("expiry-check");
    expect(principal?.permissions).toEqual(["resource:read", "pipeline:run"]);
  });

  it("اعتماد منقضٍ يُرفض fail-closed حتى بلا إلغاء", async () => {
    const world = await buildOnboarded("bootstrap-expiry-check");
    const after = await authenticateApiKey(
      world.auth, `Bearer bootstrap-expiry-check.${world.result.apiKey}`, world.semantic, new Date("2030-02-15T00:00:00.000Z"),
    );
    expect(after).toBeNull();
    // لحظة الانتهاء نفسها = منقضٍ (<=)
    const boundary = await authenticateApiKey(
      world.auth, `Bearer bootstrap-expiry-check.${world.result.apiKey}`, world.semantic, new Date(world.result.expiresAt),
    );
    expect(boundary).toBeNull();
  });

  it("مفتاح مستأجر آخر بصيغة legacy لا يفتح المستأجر الجديد", async () => {
    const world = await buildOnboarded("bootstrap-expiry-check");
    const stranger = await authenticateApiKey(
      world.auth, `Bearer expiry-check:${world.result.apiKey}`, world.semantic, new Date(NOW_ISO),
    );
    // مسار legacy يفشل: hash المستأجر خامد لا يطابق مفتاح الاعتماد
    expect(stranger).toBeNull();
  });

  it("اعتماد ملغى يدوياً يُرفض فوراً", async () => {
    const world = await buildOnboarded("bootstrap-expiry-check");
    const credential = await world.auth.findApiCredential("bootstrap-expiry-check");
    await world.auth.putApiCredential({ ...credential!, revokedAt: "2030-01-16T00:00:00.000Z" });
    const principal = await authenticateApiKey(
      world.auth, `Bearer bootstrap-expiry-check.${world.result.apiKey}`, world.semantic, new Date(NOW_ISO),
    );
    expect(principal).toBeNull();
  });
});
