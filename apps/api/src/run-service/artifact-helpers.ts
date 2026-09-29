/**
 * مساعدو حفظ الحزم والشهادات — منطق finalize المعزول عن حلقة التشغيل.
 *
 * ماهيتها: فصل منطق استخراج الـartifact من snapshot وتخزين الشهادة/الحزمة
 * والـpipeline في L2 — فلا يتضخم run-service.ts فوق 200 سطر.
 * وظيفتها: تحديث سجل pipeline، حفظ الشهادة إن وجدت، وحفظ حزمة الخادم
 * المولد من snapshot موقعة بعد تحقق مخططي — كل ذلك بمعزل عن drive نفسه.
 * كيف: دوال نقية تستقبل التبعيات (semantic/episodic/logger) وتؤدي أثراً واحداً
 * لكل استدعاء — لا حلقات ولا منطق تنسيق هنا.
 */

import type { RunSummary } from "@agentbridge/orchestrator";
import type { EpisodicStore, SemanticStore } from "@agentbridge/memory";
import type { FastifyBaseLogger } from "fastify";
import type { StartOptions } from "../run-service-contracts.js";
import { snapshotKeyRingOf } from "./snapshot-read.js";
import { readSnapshotView } from "./snapshot-read.js";

/**
 * يستخرج artifact الخادم من آخر snapshot موقعة بعد تحقق مخططي.
 */
export async function readArtifactFromSnapshot(
  episodic: EpisodicStore,
  tenantId: string,
  runId: string,
  // حلقة تحقق الإعداد — من يملك المفاتيح الثابتة يمررها
  keyRing?: ReturnType<typeof snapshotKeyRingOf>,
): Promise<{ files: { path: string; contents: string }[]; toolNames: string[] } | null> {
  const snapshot = await episodic.loadSnapshot(tenantId, runId);
  if (snapshot === null) return null;
  const restored = readSnapshotView(snapshot, keyRing);
  if (restored === null || restored.data.artifact === undefined) return null;
  const artifact = restored.data.artifact;
  return {
    files: artifact.files.map((file) => ({ path: file.path, contents: file.contents })),
    toolNames: [...artifact.toolNames],
  };
}

/**
 * يختم التشغيل في L2/L1: pipeline + شهادة + artifact — مع تغاضي آمن عن الحزمة.
 */
export async function persistRunResult(
  deps: { semantic: SemanticStore; episodic: EpisodicStore; logger?: FastifyBaseLogger; readonly snapshotSigning?: import("@agentbridge/orchestrator").SnapshotSigningMaterial; readonly snapshotVerifyKeys?: import("@agentbridge/orchestrator").SnapshotKeyRing },
  options: StartOptions,
  summary: RunSummary,
): Promise<void> {
  const { tenantId, runId } = options;
  await deps.semantic.upsertPipeline({
    runId,
    tenantId,
    projectId: options.projectId,
    specId: options.specId,
    status: summary.finalStatus,
    ...(summary.stoppedAt !== undefined ? { stoppedAt: summary.stoppedAt } : {}),
    repairCyclesUsed: summary.repairCyclesUsed,
    createdAt: summary.events[0]?.at ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await deps.episodic.saveRunStatus(tenantId, runId, summary.finalStatus);

  if (summary.certificate !== undefined) {
    await deps.semantic.saveCertificate({
      runId,
      tenantId,
      finalScore: summary.certificate.finalScore,
      granted: summary.certificate.granted,
      verificationId: summary.certificate.verificationId,
      certificateJson: JSON.stringify(summary.certificate),
      issuedAt: summary.certificate.issuedAt,
    });
  }

  try {
    // حلقة تحقق الإعداد تصل قراءة artifact داخل الختم
    const artifact = await readArtifactFromSnapshot(deps.episodic, tenantId, runId, snapshotKeyRingOf(deps.snapshotSigning, deps.snapshotVerifyKeys));
    if (artifact !== null) {
      // بوابة الاعتماد: يُحفظ كحزمة قابلة للتنزيل فقط ما كان معتمداً —
      // غير المعتمد يبقى في snapshot نطاق المستأجر للتشخيص الداخلي حصراً،
      // ولا يظهر كسجل artifact يوحي بأنه حزمة إنتاجية.
      if (summary.certificate?.granted === true) {
        await deps.semantic.saveArtifact({
          runId,
          tenantId,
          artifactJson: JSON.stringify(artifact),
          createdAt: new Date().toISOString(),
        });
      } else {
        deps.logger?.info({ code: "ARTIFACT_NOT_CERTIFIED", runId }, "لم تُحفظ حزمة غير معتمدة — التشخيص الداخلي من snapshot فقط");
      }
    }
  } catch {
    deps.logger?.warn({ code: "ARTIFACT_PERSIST_FAILED" }, "تعذر حفظ حزمة الخادم المولد");
  }
}
