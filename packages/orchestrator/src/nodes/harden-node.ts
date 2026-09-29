/**
 * عقدة harden — التحصين الكامل: ساكنة + حية + تدقيق المدقق.
 *
 * التسلسل الإلزامي:
 *   1. كتابة artifact على القرص (مجلد نظيف كل مرة — idempotency).
 *   2. الفحوص الساكنة العشرة على الـartifact.
 *   3. الفحوص الحية الأربعة على خادم مقلع فعلياً (إن طُلبت).
 *   4. بناء SecurityReport الموحد.
 *   5. نتيجة حرجة؟ فشل فوري fatal (لا إصلاح تلقائي — وثيقة 09).
 *   6. نتائج غير حرجة؟ المدقق يرتبها ويوصي → needs_repair.
 *   7. نظافة كاملة؟ completed.
 */

import { AuditorAgent } from "@agentbridge/agents";
import { writeArtifact } from "@agentbridge/generator";
import { computeArtifactsHash } from "@agentbridge/evaluator";
import {
  buildSecurityReport,
  extractManifestToolNames,
  parseManifest,
  runLiveProbes,
  runStaticChecks,
} from "@agentbridge/hardening";
import { Errors, type AppError } from "@agentbridge/shared";
import type { LlmProvider } from "@agentbridge/llm";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { NodeOutcome, PipelineNode } from "../graph.js";
import { isTransientError } from "../retry-policy.js";
import type { PipelineContext } from "../context-store.js";
import { deriveProbeTargets } from "./probe-targets.js";
import { runSandboxLiveProbes, assertSeccompProfileBlocksMounts, type SandboxProbeRun } from "./sandbox-probes.js";

/**
 * محمل tsx كـURL مطلق — الفحص الحي يقلع الخادم المولد بمجلد عمل مؤقت
 * خارج شجرة المستودع، وتحليل `--import tsx` النسبي من هناك يفشل.
 * التثبيت المطلق يجعل الإقلاع مستقلاً عن cwd.
 */
function tsxLoaderImport(): string {
  try {
    return pathToFileURL(createRequire(import.meta.url).resolve("tsx")).toString();
  } catch {
    return "tsx"; // غياب tsx سيظهر كفشل إقلاع واضح في سجل الفحص لا كسر مسار
  }
}

export interface HardenOptions {
  /** مجلد كتابة الخادم للفحص الحي — يُمسح ويُعاد بناؤه كل تشغيل */
  readonly workDir: string;
  /** هل تجري الفحوص الحية؟ تتطلب بيئة تشغيل tsx محلياً */
  readonly liveProbes: boolean;
  /**
   * تشغيل الفحوص الحية **داخل حاوية sandbox معزولة** بدل المضيف —
   * الغياب يعني المضيف الموثوق (الوضع الافتراضي)؛ الحضور يمنع أي إقلاع للخادم
   * المولد خارج العزل.
   */
  readonly sandbox?: boolean;
}

export function createHardenNode(
  context: PipelineContext,
  provider: LlmProvider,
  options: HardenOptions,
): PipelineNode {
  return {
    stage: "harden",
    kind: "agent",
    async run(): Promise<NodeOutcome> {
      const artifact = context.data.artifact;
      const analyzed = context.data.analyzed;
      const designs = context.data.designs;
      if (artifact === undefined || analyzed === undefined || designs === undefined) {
        return {
          kind: "failed",
          fatal: true,
          error: Errors.internal("harden بلا artifact/تحليل/تصاميم — تسلسل الرسم مكسور"),
        };
      }

      // 1) كتابة نظيفة — أي بقايا قديمة تُمسح لضمان نفس المدخل = نفس النتيجة
      rmSync(options.workDir, { recursive: true, force: true });
      const written = await writeArtifact(artifact, { targetDir: options.workDir });
      if (!written.ok) return { kind: "failed", fatal: true, error: written.error };

      // 2) الساكنة دائماً
      const results = [...runStaticChecks(artifact)];

      // 3) الحية عند الطلب — اشتقاق أهداف حتمي، وغياب مرشح موثق لا مخفي
      if (options.liveProbes) {
        const targets = deriveProbeTargets(designs, analyzed);
        if (targets === undefined) {
          return {
            kind: "failed",
            fatal: false,
            error: Errors.invalidInput("لا أداة صالحة لأهداف الفحص الحي — أضف معامل مسار أو نصي"),
          };
        }
        const manifestFile = artifact.files.find((file) => file.path === "manifest.json");
        const parsedManifest = manifestFile !== undefined ? parseManifest(manifestFile.contents) : null;
        const declared = (parsedManifest !== null ? extractManifestToolNames(parsedManifest) : []) ?? [];

        // وضع sandbox = لا إقلاع للخادم المولد خارج الحاوية
        let liveChecks: readonly typeof results[number][];
        let evidenceExecutedAt: string;
        let sandboxAttestation: SandboxProbeRun["sandbox"] | undefined;
        if (options.sandbox === true) {
          const seccomp = assertSeccompProfileBlocksMounts();
          if (!seccomp.ok) return { kind: "failed", fatal: true, error: seccomp.error };
          const sandboxRun = runSandboxLiveProbes({ artifact, declaredToolNames: declared, targets });
          if (!sandboxRun.ok) {
            // فشل sandbox = فشل مرحلة — لا شهادة أصلاً
            return { kind: "failed", fatal: !isTransientError(sandboxRun.error), error: sandboxRun.error };
          }
          liveChecks = sandboxRun.value.checks;
          evidenceExecutedAt = sandboxRun.value.sandbox.startedAt;
          sandboxAttestation = sandboxRun.value.sandbox;
        } else {
          const live = await runLiveProbes({
            command: process.execPath,
            args: ["--import", tsxLoaderImport(), join(options.workDir, "src", "server.ts")],
            cwd: options.workDir,
            declaredToolNames: declared,
            leakTarget: targets.leakTarget,
            traversalTarget: targets.traversalTarget,
          });
          if (!live.ok) return { kind: "failed", fatal: !isTransientError(live.error), error: live.error };
          liveChecks = live.value;
          evidenceExecutedAt = new Date().toISOString();
        }
        results.push(...liveChecks);

        // دليل الفئات الحية: يُبنى خادمياً هنا ويرتبط ببصمة
        // الـartifact نفسها — certify لن يمنح شهادة إلا بهذا الدليل الصالح.
        const livePassed = liveChecks.filter((check) => check.passed).length;
        const probedHash = computeArtifactsHash(artifact);
        context.data.liveProbeEvidence = {
          checksTotal: liveChecks.length,
          checksPassed: livePassed,
          probedArtifactsHash: probedHash,
          executedAt: evidenceExecutedAt,
        };
        if (sandboxAttestation !== undefined) {
          // إثبات البيئة: ربط الدليل بصورة runner وسياسة العزل
          context.data.liveProbeRun = {
            checksTotal: liveChecks.length,
            checksPassed: livePassed,
            probedArtifactsHash: probedHash,
            executedAt: evidenceExecutedAt,
            sandbox: sandboxAttestation,
          };
        }
      }

      // 4) التقرير الموحد
      const report = buildSecurityReport(results);
      context.data.securityReport = report;

      // 5) بوابة الحرجة: فشل فوري لا إصلاح يتجاوزه
      if (report.hasCritical) {
        const criticalId = report.findings.find((finding) => finding.severity === "critical")?.id ?? "?";
        return { kind: "failed", fatal: true, error: Errors.securityCritical(criticalId) };
      }

      // 6) نتائج غير حرجة → المدقق يرتّبها ويوصي بإصلاحها
      if (report.findings.length > 0) {
        const audited = await new AuditorAgent(provider).audit({
          artifact,
          securityReport: report,
          tenantId: context.tenantId,
        });
        if (!audited.ok) {
          return { kind: "failed", fatal: !isTransientError(audited.error), error: audited.error };
        }
        context.data.auditedFindings = audited.value.auditedFindings;        return {
          kind: "needs_repair",
          failure: {
            stage: "harden",
            summary: `فشل ${report.findings.length} من ${report.totalChecks} فحصاً بدرجة نظافة ${report.cleanlinessScore}`,
            findings: audited.value.auditedFindings,
            attempt: context.repairCyclesUsed,
          },
        };
      }

      // 7) نظافة كاملة
      return {
        kind: "completed",
        summary: `اجتاز ${report.passedCount}/${report.totalChecks} فحصاً بدرجة نظافة ${report.cleanlinessScore}`,
        code: "harden.passed",
        params: { passed: report.passedCount, total: report.totalChecks, cleanliness: report.cleanlinessScore },
      };
    },
  };
}

/** تصنيف مساعد للمحرك — يعيد الخطأ كما لو fatal بحسب سياسة العابر */
export function asFatal(error: AppError): boolean {
  return !isTransientError(error);
}
