/**
 * عقدة certify — قرار الشهادة النهائي (دائماً "مكتملة" حتى الرفض).
 *
 * الرفض ليس فشل أنبوب؛ إنه قرار موثق بدرجته ورقم تحقيقه يبقى في
 * سجل التدقيق كالأيجابي. أخطاء المدخلات (تقرير مخالف/صفر فحوص) وحدها
 * توقف الأنبوب fatal لأنها تعني عيباً بنيوياً في ما قبله.
 *
 * المنح يربط خادمياً بـrunId/tenantId/policyVersion وإثبات
 * sandbox (عند وجوده) — والشهادة تُوقّع بمادة إعداد الخادم عند تمريرها
 * عبر خيارات المنسق (CERT_SIGNING_PRIVATE_KEY). بلا مادة تُترك غير موقعة
 * مع بقاء بوابة المنح قائمة — التوقيع تثبت منشأ لا شرط منح.
 */

import { certifyArtifacts, signCertificate } from "@agentbridge/evaluator";
import type { SigningKeyMaterial } from "@agentbridge/evaluator";
import { Errors, ok } from "@agentbridge/shared";
import { SNAPSHOT_POLICY_VERSION } from "../snapshot-signing.js";
import type { NodeOutcome, PipelineNode } from "../graph.js";
import type { PipelineContext } from "../context-store.js";

export function createCertifyNode(
  context: PipelineContext,
  signing?: SigningKeyMaterial,
): PipelineNode {
  return {
    stage: "certify",
    kind: "deterministic",
    async run(): Promise<NodeOutcome> {
      const artifact = context.data.artifact;
      const report = context.data.securityReport;
      if (artifact === undefined || report === undefined) {
        return {
          kind: "failed",
          fatal: true,
          error: Errors.internal("certify بلا artifact أو تقرير أمني — تسلسل الرسم مكسور"),
        };
      }
      // إثبات sandbox من سجل الفحص الحي داخل العزل — يمرر لبوابة
      // المنح عند حضوره فقط، وإلا يبقى المنح ببوابتيه القائمتين
      const sandboxRun = context.data.liveProbeRun?.sandbox;
      const certified = certifyArtifacts({
        artifact,
        securityReport: report,
        qualityScores: context.data.qualityScores,
        // بوابة الدليل الحي: بلا دليل حي صالح المرتبط بالبصمة لا يُمنح شيء
        liveProbeEvidence: context.data.liveProbeEvidence,
        // ربط المنح بهوية التشغيل وسياسة snapshots المعتمدة
        runBinding: { runId: context.runId, tenantId: context.tenantId, policyVersion: SNAPSHOT_POLICY_VERSION },
        ...(sandboxRun !== undefined
          ? {
              sandbox: {
                imageRef: sandboxRun.imageRef,
                imageDigest: sandboxRun.imageDigest,
                seccompProfile: sandboxRun.seccompProfile,
                constraintsVersion: sandboxRun.constraintsVersion,
                network: sandboxRun.network,
                user: sandboxRun.user,
                exitCode: sandboxRun.exitCode,
              },
            }
          : {}),
      });
      if (!certified.ok) {
        return { kind: "failed", fatal: true, error: certified.error };
      }
      // التوقيع بمادة الخادم عند توفرها — فشل التوقيع يوقف العقدة
      // (لا شهادة تمر بصمت على أنها موقعة وهي غير موقعة)
      const certificate = signing !== undefined ? signCertificate(certified.value, { material: signing }) : ok(certified.value);
      if (!certificate.ok) {
        return { kind: "failed", fatal: true, error: certificate.error };
      }
      context.data.certificate = certificate.value;
      return {
        kind: "completed",
        summary: certificate.value.granted
          ? `شهادة منححة بدرجة ${certificate.value.finalScore} ورقم ${certificate.value.verificationId}${certificate.value.signature !== undefined ? " موقعة" : ""}`
          : `شهادة مرفوضة بدرجة ${certificate.value.finalScore} — القرار موثق برقم ${certificate.value.verificationId}`,
        // كودا القرار ومعاملات منظمة — verificationId تقنية ASCII آمنة للعرض
        code: certificate.value.granted ? "certify.granted" : "certify.denied",
        params: {
          score: certificate.value.finalScore,
          verificationId: certificate.value.verificationId,
          ...(certificate.value.notGrantedReasonCode !== undefined ? { reason: certificate.value.notGrantedReasonCode } : {}),
        },
      };
    },
  };
}
