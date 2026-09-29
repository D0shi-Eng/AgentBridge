/**
 * منفّذ الاحتفاظ — مسح دوري محصور بنطاق مستأجر لكل صنف قابل للتقادم.
 *
 * المبدئان الحاكمان:
 * - لا مسح شامل بلا سياق: كل عملية حذف تمر بنطاق المستأجر (FORCE RLS) —
 *   قائمة المستأجرين تأتي من المشغّل لا من مسح عريض داخل العملية.
 * - الصدق قبل الاكتمال: الأصناف التي لا يملك المخزن سطح حذف لها تُعلن
 *   بأوضاعها الحقيقية (ttl-at-write / declared / permanent /
 *   tenant-lifetime / ephemeral) — لا ادعاء حذف لم يقع.
 *
 * الإبطالات العامة وسجل التدقيق غير قابلَين للمسح بنيوياً — /verify
 * العام ونزاعة سلسلة الهاش يعتمدان عليهما بعد انتهاء المستأجر نفسه.
 */

import type { SweepClassResult } from "@agentbridge/memory";
import type { RetentionPolicy } from "./retention-policy.js";

/** عمليات الحذف بالتقادم التي يطلبها المنفّذ — كلها بنطاق مستأجر */
export interface RetentionSweepPort {
  purgeExpiredArtifacts(tenantId: string, cutoffIso: string): Promise<number>;
  purgeExpiredSessions(tenantId: string, cutoffIso: string): Promise<number>;
  purgeExpiredLoginTransactions(tenantId: string, cutoffIso: string): Promise<number>;
  purgeExpiredRunArchives(tenantId: string, cutoffIso: string): Promise<number>;
  purgeExpiredVectorEmbeddings(tenantId: string, cutoffIso: string): Promise<number>;
  purgeExpiredFlywheelLessons(tenantId: string, cutoffIso: string): Promise<number>;
}

export interface RetentionSweepResult {
  readonly startedUtc: string;
  readonly finishedUtc: string;
  readonly tenantIds: readonly string[];
  /** نتيجة لكل (مستأجر × صنف) — الأصناف الدائمة/المعلنة بأوضاعها بلا حذف */
  readonly classes: readonly SweepClassResult[];
}

const DAY_MS = 86_400_000;

/** يحسب حد التقادم لقيمة السياسة؛ permanent يعيد null (لا مسح) */
function cutoffFor(days: number | "permanent", nowMs: number): string | null {
  if (days === "permanent") return null;
  return new Date(nowMs - days * DAY_MS).toISOString();
}

/** يشغّل مسحاً واحداً على مستأجرين معلنين ويعيد النتيجة الموثقة كاملة */
export async function runRetentionSweep(
  port: RetentionSweepPort,
  policy: RetentionPolicy,
  tenantIds: readonly string[],
  nowIso: string,
): Promise<RetentionSweepResult> {
  if (tenantIds.length === 0) {
    throw new Error("المسح يتطلب قائمة مستأجرين معلنة — لا مسح شامل بلا سياق");
  }
  const nowMs = Date.parse(nowIso);
  const classes: SweepClassResult[] = [];

  /** مسح صنف واحد عبر المستأجرين المعلنين، أو توثيقه دائماً إن كان دائماً */
  const sweepClass = async (
    dataClass: string,
    days: number | "permanent",
    op: (tenantId: string, cutoffIso: string) => Promise<number>,
  ): Promise<void> => {
    const cutoff = cutoffFor(days, nowMs);
    if (cutoff === null) {
      classes.push({ dataClass, mode: "permanent", removed: 0 });
      return;
    }
    let removed = 0;
    for (const tenantId of tenantIds) removed += await op(tenantId, cutoff);
    classes.push({ dataClass, mode: "swept", removed });
  };

  await sweepClass("artifacts", policy.artifacts, (t, c) => port.purgeExpiredArtifacts(t, c));
  await sweepClass("sessions", policy.sessions, (t, c) => port.purgeExpiredSessions(t, c));
  await sweepClass("loginTransactions", policy.loginTransactions, (t, c) => port.purgeExpiredLoginTransactions(t, c));
  await sweepClass("runArchives", policy.runArchives, (t, c) => port.purgeExpiredRunArchives(t, c));
  await sweepClass("memoryVector", policy.memoryVector, (t, c) => port.purgeExpiredVectorEmbeddings(t, c));
  await sweepClass("flywheelLessons", policy.flywheelLessons, (t, c) => port.purgeExpiredFlywheelLessons(t, c));

  // أصناف بأوضاع موثقة لا مسح لها هنا — الشفافية بدل الادعاء
  classes.push({ dataClass: "episodicEvents", mode: "ttl-at-write", removed: 0 });
  classes.push({ dataClass: "signedSnapshots", mode: "ttl-at-write", removed: 0 });
  classes.push({ dataClass: "operationalLogs", mode: "declared", removed: 0 });
  classes.push({ dataClass: "backups", mode: "declared", removed: 0 });
  classes.push({ dataClass: "semanticCore", mode: "tenant-lifetime", removed: 0 });
  classes.push({ dataClass: "ssoConfig", mode: "tenant-lifetime", removed: 0 });
  classes.push({ dataClass: "memoryWorking", mode: "ephemeral", removed: 0 });
  classes.push({ dataClass: "auditLog", mode: "permanent", removed: 0 });
  classes.push({ dataClass: "revocations", mode: "permanent", removed: 0 });
  // صفوف الشهادات لا سطح حذف دورياً لها — الحي يُدار بسير حذف المستأجر
  // والإبطالات المرتبطة أبدية؛ توثيق الوضع أصدق من ادعاء مسح غير منفذ
  classes.push({ dataClass: "certificates", mode: policy.certificates === "permanent" ? "permanent" : "declared", removed: 0 });

  return { startedUtc: nowIso, finishedUtc: new Date().toISOString(), tenantIds: [...tenantIds], classes };
}
