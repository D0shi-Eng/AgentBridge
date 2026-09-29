/**
 * اختبارات دوران مفاتيح snapshots: حلقة التحقق للقراءة فقط.
 *
 * تثبت: (1) snapshot موقعة بمفتاح قديم تُقبل للتحقق متى وُضع المفتاح
 * القديم في حلقة التحقق مع مفتاح جديد للإصدار؛ (2) بلا الحلقة يرفض
 * الاستئناف SNAPSHOT_UNKNOWN_KEY؛ (3) الإصدار الجديد يبقى بالمفتاح
 * الحالي حصراً؛ (4) مفتاح تحقق من SPKI يدخل الحلقة بنفس keyId والفاسد يُرفض.
 * المظروف يُبنى مباشرة عبر PipelineContext — العقد قيد الاختبار توقيعي
 * لا تنفيذي، فلا حاجة لتشغيل أنبوب صالح كامل.
 */

import { describe, expect, it } from "vitest";
import {
  generateSnapshotSigningMaterial,
  loadSnapshotVerifyKey,
  PipelineContext,
  PipelineOrchestrator,
} from "../src/index.js";
import type { SnapshotKeyRing, SnapshotResumeBinding } from "../src/index.js";
import { AppError } from "@agentbridge/shared";

/** مزود لا يُستدعى — بوابات التحقق تسبق أي مرحلة LLM */
const unusedProvider = {
  name: "unused-mock",
  complete: async (): Promise<import("@agentbridge/shared").Result<import("@agentbridge/llm").LlmResponse>> => ({
    ok: false as const,
    error: new AppError("UNUSED", "يجب ألا يُستدعى", false, "warning"),
  }),
};

const RESUME_BINDING: SnapshotResumeBinding = { allowedSubjects: [], minAuthorizationVersion: 0 };

/** snapshot موقعة بمفتاح محدد عبر العقد المباشر — مدخل الاستئناف */
function snapshotSignedWith(material: Parameters<PipelineContext["toSignedSnapshot"]>[0]["material"]): string {
  return new PipelineContext("run-rot-1", "tenant-rot").toSignedSnapshot({
    material,
    resumeBinding: RESUME_BINDING,
    inputDigests: {},
  });
}

function orchestrator(overrides: { signing?: ReturnType<typeof generateSnapshotSigningMaterial>; verifyKeys?: SnapshotKeyRing } = {}): PipelineOrchestrator {
  return new PipelineOrchestrator({
    runId: "run-rot-1",
    tenantId: "tenant-rot",
    rawSpec: "openapi: 3.0.0\ninfo:\n  title: t\n  version: 1\npaths: {}",
    provider: unusedProvider,
    harden: { workDir: "./.tmp-rot", liveProbes: false },
    ...(overrides.signing !== undefined ? { snapshotSigning: overrides.signing } : {}),
    ...(overrides.verifyKeys !== undefined ? { snapshotVerifyKeys: overrides.verifyKeys } : {}),
  });
}

describe("دوران مفاتيح snapshots — تحقق قراءة فقط", () => {
  it("snapshot بمفتاح قديم تُقبل للتحقق ضمن حلقة الدوران — والإصدار الجديد يبقى بالمفتاح الحالي", async () => {
    const oldKey = generateSnapshotSigningMaterial();
    const newKey = generateSnapshotSigningMaterial();
    const snapshotFromOldKey = snapshotSignedWith(oldKey);

    // مفتاح جديد للإصدار + القديم للتحقق فقط → لا رفض مفتاح (أي مصير لاحق مقبول)
    const resumed = orchestrator({ signing: newKey, verifyKeys: new Map([[oldKey.keyId, oldKey.publicKey]]) });
    const summary = await resumed.resume(snapshotFromOldKey);
    expect(summary.reason ?? "").not.toContain("SNAPSHOT_UNKNOWN_KEY");

    // الإصدار دائماً بالمفتاح الحالي — المظروف الجديد يحمل keyId الجديد حصراً
    const fresh = new PipelineContext("run-rot-2", "tenant-rot").toSignedSnapshot({
      material: newKey,
      resumeBinding: RESUME_BINDING,
      inputDigests: {},
    });
    expect(fresh).toContain(newKey.keyId);
    expect(fresh).not.toContain(oldKey.keyId);
  });

  it("بلا حلقة الدوران يرفض الاستئناف بمفتاح مجهول — لا قبول صامت", async () => {
    const oldKey = generateSnapshotSigningMaterial();
    const snapshotFromOldKey = snapshotSignedWith(oldKey);

    const resumed = orchestrator({ signing: generateSnapshotSigningMaterial(), verifyKeys: undefined });
    const summary = await resumed.resume(snapshotFromOldKey);
    expect(summary.reason).toContain("SNAPSHOT_UNKNOWN_KEY");
  });

  it("مفتاح تحقق من SPKI يدخل الحلقة بنفس keyId المشتق — والفاسد يُرفض", () => {
    const key = generateSnapshotSigningMaterial();
    const spkiBase64 = key.publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const loaded = loadSnapshotVerifyKey(spkiBase64);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.keyId).toBe(key.keyId);

    const broken = loadSnapshotVerifyKey("bm90LWEta2V5"); // "not-a-key"
    expect(broken.ok).toBe(false);
  });
});
