/**
 * اختبارات سير حذف المستأجر المسوَّر — dry-run،
 * الحجز القانوني، التنفيذ، إعادة الإرسال الإيدبوتنتية بلا وصل مكرر،
 * تعارض النسيج المختلف، تعطيل التوازي، الهويات اليتيمة والمشتركة،
 * تقليل بيانات القبر، والاستعادة بعد فشل منتصف العملية.
 */

import { describe, expect, it } from "vitest";
import {
  createInMemoryAuthStore, createInMemoryDeletionOperationStore,
  createInMemorySemanticStore, type TenantLifecycleStore,
} from "@agentbridge/memory";
import { HashChainAuditLog } from "./audit-chain.js";
import { confirmTenantDeletionFenced, fenceHashOf, DeletionFlowError } from "./tenant-deletion-operations.js";
import { TenantDeletionError, dryRunTenantDeletion } from "./tenant-deletion.js";
import { onboardTenantInMemory, type OnboardingAuditSink, type OnboardingInput } from "./tenant-onboarding.js";

const NOW = "2026-09-20T12:00:00.000Z";
const FENCE = "fence-confirm-0001";
const FENCE2 = "fence-confirm-0002";

/** يبني مستأجرين اثنين ببيانات تشغيلية وإبطال عام على الأول */
async function buildWorld() {
  const semantic = createInMemorySemanticStore();
  const auth = createInMemoryAuthStore();
  const auditChain = new HashChainAuditLog(semantic);
  const audit: OnboardingAuditSink = { async record(input) { return auditChain.record(input); } };
  const operations = createInMemoryDeletionOperationStore(audit);
  const deps = {
    semantic, auth, lifecycle: semantic,
    deleteTenant: (id: string) => semantic.deleteTenant(id),
    deleteExternalIdentityById: (id: string) => auth.deleteExternalIdentityById(id),
    deleteMembership: (id: string) => auth.deleteMembership(id),
    deleteApiCredential: (id: string) => auth.deleteApiCredential(id),
  };
  const input = (tenantId: string, name: string, n: number, subjectSuffix = `owner-${n}`): OnboardingInput => ({
    tenantId, tenantName: name, ownerIssuer: "https://idp.example.test", ownerSubject: subjectSuffix,
    credentialPermissions: ["resource:read", "pipeline:run"], expiresInDays: 30, nowIso: NOW,
  });
  const alpha = await onboardTenantInMemory(deps, input("alpha", "ألفا", 1));
  await onboardTenantInMemory(deps, input("beta", "بيتا", 2));
  // هوية مشتركة عضو في alpha وbeta — حذف alpha يجب ألا يمسها
  const shared = { identityId: "ident-shared", issuer: "https://idp.example.test", subject: "shared-user", createdAt: NOW };
  await auth.putExternalIdentity(shared);
  await auth.putMembership({ membershipId: "member-shared-a", identityId: shared.identityId, tenantId: "alpha", role: "reader", status: "active", authorizationVersion: 1 });
  await auth.putMembership({ membershipId: "member-shared-b", identityId: shared.identityId, tenantId: "beta", role: "reader", status: "active", authorizationVersion: 1 });
  // بيانات تشغيلية للمستأجر alpha
  await semantic.createProject({ projectId: "p1", tenantId: "alpha", name: "مشروع", createdAt: NOW });
  await semantic.createSpec({ specId: "s1", tenantId: "alpha", projectId: "p1", content: "openapi: 3.0.0", createdAt: NOW });
  await semantic.upsertPipeline({ runId: "r1", tenantId: "alpha", projectId: "p1", specId: "s1", status: "completed", repairCyclesUsed: 0, createdAt: NOW, updatedAt: NOW });
  await semantic.saveCertificate({ runId: "r1", tenantId: "alpha", finalScore: 90, granted: true, verificationId: "ver-1", certificateJson: "{}", issuedAt: NOW });
  await semantic.saveArtifact({ runId: "r1", tenantId: "alpha", artifactJson: "{}", createdAt: NOW });
  await semantic.revokeCertificate({ tenantId: "alpha", runId: "r1", verificationId: "ver-1", reason: "اختبار", revokedAt: NOW });
  // بيانات مميزة لبيتا يجب ألا تُمس
  await semantic.createProject({ projectId: "bp1", tenantId: "beta", name: "مشروع بيتا", createdAt: NOW });
  // دورة الحياة الكاملة: الجانبان الدلالي والأمني + رفض صريح لعمليات L3/L4
  const lifecycle: TenantLifecycleStore = {
    ...semantic,
    ...auth,
    purgeExpiredVectorEmbeddings: () => Promise.reject(new Error("غير مستخدم في هذا الاختبار")),
    purgeExpiredFlywheelLessons: () => Promise.reject(new Error("غير مستخدم في هذا الاختبار")),
  };
  const flowDeps = { lifecycle, operations };
  return { semantic, auth, audit, operations, flowDeps, alphaIdentityId: alpha.identityId };
}

describe("سير حذف المستأجر المسوَّر", () => {
  it("dry-run يعرض الأثر كاملاً بلا أي تغيير حالة", async () => {
    const world = await buildWorld();
    const report = await dryRunTenantDeletion({ lifecycle: world.flowDeps.lifecycle, audit: world.audit }, "alpha");
    expect(report.verdict).toBe("READY");
    expect(report.impact).toMatchObject({ projects: 1, specs: 1, pipelines: 1, certificates: 1, artifacts: 1 });
    expect(report.impact?.credentialsRevoked).toBe(1);
    expect(report.revocationsKeptVerificationIds).toEqual(["ver-1"]);
    // لا شيء تغير: البيانات قائمة والمستأجر حي
    expect(await world.semantic.getProject("alpha", "p1")).not.toBeNull();
    expect((await world.semantic.getTenantLifecycleState("alpha"))?.deletedAt).toBeUndefined();
  });

  it("المستأجر غير الموجود يعطي NOT_FOUND لا خطأ صامت", async () => {
    const world = await buildWorld();
    const report = await dryRunTenantDeletion({ lifecycle: world.flowDeps.lifecycle, audit: world.audit }, "ghost");
    expect(report.verdict).toBe("NOT_FOUND");
  });

  it("الحجز القانوني النافذ يمنع dry-run الجاهز والتأكيد كلياً", async () => {
    const world = await buildWorld();
    await world.flowDeps.lifecycle.setTenantLegalHold("alpha", "2099-01-01T00:00:00.000Z");
    const report = await dryRunTenantDeletion({ lifecycle: world.flowDeps.lifecycle, audit: world.audit }, "alpha");
    expect(report.verdict).toBe("LEGAL_HOLD");
    await expect(confirmTenantDeletionFenced(world.flowDeps, "alpha", FENCE, "alpha", NOW))
      .rejects.toMatchObject({ code: "LEGAL_HOLD" });
    expect(await world.semantic.getProject("alpha", "p1")).not.toBeNull();
  });

  it("التأكيد ينفذ السير: وصول ميت، بيانات ممسوحة، هوية المالك اليتيمة حذفت، الإبطال والتدقيق بقيا، قبر مُقلَّل", async () => {
    const world = await buildWorld();
    const { receipt } = await confirmTenantDeletionFenced(world.flowDeps, "alpha", FENCE, "alpha", NOW);
    // الوصول ميت: الاعتماد حُذف كلياً بعد إلغائه (بيانات تشغيلية)
    expect(await world.auth.findApiCredential("bootstrap-alpha")).toBeNull();
    // البيانات التشغيلية ممسوحة
    expect(await world.semantic.getProject("alpha", "p1")).toBeNull();
    expect(await world.semantic.getArtifact("alpha", "r1")).toBeNull();
    expect(await world.semantic.getCertificate("alpha", "r1")).toBeNull();
    // هوية مالك alpha اليتيمة (لا عضوية أخرى) حذفت — هوية المشتركة بقيت
    expect(await world.auth.findMembership(world.alphaIdentityId, "alpha")).toBeNull();
    await expect(world.auth.findExternalIdentity("https://idp.example.test", "owner-1")).resolves.toBeNull();
    await expect(world.auth.findExternalIdentity("https://idp.example.test", "shared-user")).resolves.not.toBeNull();
    // الإبطال العام باقٍ — /verify يرفض بعد موت المستأجر
    expect((await world.semantic.getRevocationByVerificationId("ver-1"))?.verificationId).toBe("ver-1");
    // القبر مُقلَّل البيانات: مُدقّر، بلا اسم حقيقي، وبلا hash يعمل
    const tenant = await world.semantic.getTenant("alpha");
    expect(tenant?.deletedAt).toBe(NOW);
    expect(tenant?.name).not.toBe("ألفا");
    expect(tenant?.apiKeyHash).not.toBe(world.alphaIdentityId);
    // الوصل موصول ببصمة النسيج لا خامه — والخام لا يظهر في أي مكان
    expect(receipt.fenceHash).toBe(fenceHashOf(FENCE));
    const auditEntries = await world.semantic.listAuditEntries("alpha");
    expect(auditEntries.some((e) => e.stage === "tenant_deletion" && e.runId === receipt.auditCorrelationId)).toBe(true);
    expect(JSON.stringify(auditEntries)).not.toContain(FENCE);
    expect(JSON.stringify(receipt)).not.toContain(FENCE);
  });

  it("العزل: حذف ألفا لا يلمس بيتا بشيء", async () => {
    const world = await buildWorld();
    await confirmTenantDeletionFenced(world.flowDeps, "alpha", FENCE, "alpha", NOW);
    expect(await world.semantic.getProject("beta", "bp1")).not.toBeNull();
    expect(await world.auth.findApiCredential("bootstrap-beta")).not.toBeNull();
    expect((await world.semantic.getTenantLifecycleState("beta"))?.deletedAt).toBeUndefined();
    // عضوية الهوية المشتركة في بيتا باقية فعلاً
    expect(await world.auth.findMembership("ident-shared", "beta")).not.toBeNull();
  });

  it("إعادة الإرسال بنفس النسيج تعيد الإيصال نفسه بلا حذف ثانٍ ولا وصل مكرر", async () => {
    const world = await buildWorld();
    const first = await confirmTenantDeletionFenced(world.flowDeps, "alpha", FENCE, "alpha", NOW);
    const auditCount = (await world.semantic.listAuditEntries("alpha")).length;
    const replay = await confirmTenantDeletionFenced(world.flowDeps, "alpha", FENCE, "alpha", NOW);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt).toEqual(first.receipt);
    // لا وصل تدقيق إضافي إطلاقاً عند الإعادة
    expect((await world.semantic.listAuditEntries("alpha")).length).toBe(auditCount);
    expect(await world.semantic.getTenant("alpha")).not.toBeNull(); // القبر باقٍ
  });

  it("نسيج مختلف بعد الاكتمال أو أثناء عملية قائمة = تعارض صريح برمز ثابت", async () => {
    const world = await buildWorld();
    await confirmTenantDeletionFenced(world.flowDeps, "alpha", FENCE, "alpha", NOW);
    await expect(confirmTenantDeletionFenced(world.flowDeps, "alpha", FENCE2, "alpha", NOW))
      .rejects.toMatchObject({ code: "FENCE_MISMATCH" });
  });

  it("عملية قائمة تمنع فتح ثانية (تعارض صريح) ونفس النسيج يستأنف ويكمل", async () => {
    const world = await buildWorld();
    // عملية قائمة مفتوحة يدوياً تحاكي منافسة حية قبل أي تنفيذ
    const claim = await world.operations.beginOrResumeOperation("alpha", fenceHashOf(FENCE), NOW);
    expect(claim.kind).toBe("claimed");
    // فتح بنسيج آخر أثناء قائمة = تعارض توازي صريح من القرار الذري
    const conflicting = await world.operations.beginOrResumeOperation("alpha", fenceHashOf(FENCE2), NOW);
    expect(conflicting.kind).toBe("inProgressConflict");
    await expect(confirmTenantDeletionFenced(world.flowDeps, "alpha", FENCE2, "alpha", NOW))
      .rejects.toMatchObject({ code: "DELETION_IN_PROGRESS" });
    // نفس النسيج يستأنف ولا يفتح عملية ثانية ويكمل مرة واحدة
    const { replayed } = await confirmTenantDeletionFenced(world.flowDeps, "alpha", FENCE, "alpha", NOW);
    expect(replayed).toBe(false);
    const auditEntries = (await world.semantic.listAuditEntries("alpha")).filter((e) => e.stage === "tenant_deletion");
    expect(auditEntries).toHaveLength(1);
  });

  it("السياج والرمز إلزاميان ومطابقان — لا حذف بلا إرادة صريحة", async () => {
    const world = await buildWorld();
    await expect(confirmTenantDeletionFenced(world.flowDeps, "alpha", "قصير", "alpha", NOW))
      .rejects.toMatchObject({ code: "FENCE_REQUIRED" });
    await expect(confirmTenantDeletionFenced(world.flowDeps, "alpha", FENCE, "beta", NOW))
      .rejects.toMatchObject({ code: "FENCE_MISMATCH" });
    await expect(confirmTenantDeletionFenced(world.flowDeps, "ghost", FENCE, "ghost", NOW))
      .rejects.toMatchObject({ code: "TENANT_NOT_FOUND" });
  });

  it("الاستعادة: فشل المسح في المنتصف يترك وصولاً ميتاً وعملية قائمة — إعادة التأكيد بنفس النسيج تكمل", async () => {
    const world = await buildWorld();
    const failing: TenantLifecycleStore = {
      ...world.flowDeps.lifecycle,
      purgeSemanticData: async () => { throw new Error("انقطاع محاكى في منتصف المسح"); },
    };
    await expect(confirmTenantDeletionFenced({ lifecycle: failing, operations: world.operations }, "alpha", FENCE, "alpha", NOW))
      .rejects.toThrow("انقطاع محاكى");
    // الوصول ميت من الخطوة الأولى الملتزمة رغم فشل المسح
    expect((await world.auth.findApiCredential("bootstrap-alpha"))?.revokedAt).toBeDefined();
    // البيانات باقية قيد الحذف والعملية قيد التنفيذ بمرحلتها
    expect(await world.semantic.getProject("alpha", "p1")).not.toBeNull();
    const { receipt, replayed } = await confirmTenantDeletionFenced(world.flowDeps, "alpha", FENCE, "alpha", NOW);
    expect(replayed).toBe(false);
    expect(receipt.impact.projects).toBe(1);
    expect(await world.semantic.getProject("alpha", "p1")).toBeNull();
    // وصل واحد فقط رغم المحاولتين (فشل الأولى قبل الوصل)
    const auditEntries = (await world.semantic.listAuditEntries("alpha")).filter((e) => e.stage === "tenant_deletion");
    expect(auditEntries).toHaveLength(1);
  });

  it("رموز الأخطاء مستقرة ورسائلها عربية محددة", async () => {
    const world = await buildWorld();
    const error = await confirmTenantDeletionFenced(world.flowDeps, "alpha", FENCE, "wrong", NOW).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TenantDeletionError);
    expect((error as TenantDeletionError).message).toContain("رمز التأكيد");
    // نسيج مختلف على عملية قائمة = DeletionFlowError رفض توازي صريح
    await world.operations.beginOrResumeOperation("alpha", fenceHashOf(FENCE), NOW);
    const flowError = await confirmTenantDeletionFenced(world.flowDeps, "alpha", FENCE2, "alpha", NOW)
      .then(() => null).catch((e: unknown) => e);
    expect(flowError).toBeInstanceOf(DeletionFlowError);
    expect((flowError as DeletionFlowError).message).toContain("متزامنة قائمة");
  });
});
