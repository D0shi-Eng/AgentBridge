/**
 * قلب CLI — يشغل الأنبوب كاملاً من ملف مواصفة إلى شهادة على القرص.
 *
 * الاستخدام:
 *   tsx src/main.ts --spec <ملف.yaml|json> --out <مجلد> [--live] [--tenant <id>]
 *
 * المخرجات في مجلد --out: certificate.json + badge.svg + events.ndjson.
 * رموز الخروج: 0 شهادة منححة · 2 اكتمل برفض · 1 فشل أو تصعيد بشري.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { INJECTION_PATTERNS } from "@agentbridge/hardening";
import { createDeterministicResponder, MockLlmProvider } from "@agentbridge/llm";
import { renderBadge } from "@agentbridge/evaluator";
import { PipelineOrchestrator, type RunSummary } from "@agentbridge/orchestrator";
import type { StageId } from "@agentbridge/shared";

export interface CliArgs {
  readonly specPath: string;
  readonly outDir: string;
  readonly liveProbes: boolean;
  readonly tenantId: string;
}

/** محلل وسائط بسيط حتمي — بلا تبعيات خارجية */
export function parseArgs(argv: readonly string[]): CliArgs | string {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const specPath = get("--spec");
  const outDir = get("--out");
  if (specPath === undefined || outDir === undefined) {
    return "الاستخدام: agentbridge --spec <ملف المواصفة> --out <مجلد المخرجات> [--live] [--tenant <معرف>]";
  }
  return {
    specPath,
    outDir,
    liveProbes: argv.includes("--live"),
    tenantId: get("--tenant") ?? "cli-tenant",
  };
}

/** سطر حدث واحد مقروء بالعربية للطرفية */
function printEvent(stage: StageId | "orchestrator", status: string | undefined, summary: string): void {
  const suffix = status !== undefined && status.length > 0 ? ` [${status}]` : "";
  console.log(`▸ ${stage}${suffix} — ${summary}`);
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (typeof parsed === "string") {
    console.error(parsed);
    return 1;
  }

  const specAbsolutePath = resolve(parsed.specPath);
  let rawSpec: string;
  try {
    rawSpec = readFileSync(specAbsolutePath, "utf8");
  } catch {
    console.error(`تعذر قراءة ملف المواصفة: ${specAbsolutePath}`);
    return 1;
  }

  // المسار المطلق إلزامية هنا: الإقلاع الحي يبني أمر الخادم من workDir،
  // والمسار النسبي يُحل ضد مجلد العمل فيتضاعف ويفشل إقلاع الخادم المولد.
  const outDir = resolve(parsed.outDir);
  const runId = `cli-${Date.now().toString(36)}`;
  console.log(`AgentBridge — تشغيل ${runId} على «${specAbsolutePath}»`);

  const provider = new MockLlmProvider({
    respond: createDeterministicResponder({ injectionPatterns: INJECTION_PATTERNS }),
  });
  const orchestrator = new PipelineOrchestrator({
    runId,
    tenantId: parsed.tenantId,
    rawSpec,
    provider,
    harden: { workDir: join(outDir, "generated-server"), liveProbes: parsed.liveProbes },
    onEvent: (event) => printEvent(event.stage, event.stageStatus ?? "", event.summary),
  });

  const summary: RunSummary = await orchestrator.run();
  return persistOutputs(summary, outDir);
}

/** يكتب مخرجات التشغيل ويعيد رمز الخروج المناسب */
export function persistOutputs(summary: RunSummary, outDir: string): number {
  mkdirSync(outDir, { recursive: true });

  const eventsNdjson = summary.events.map((event) => JSON.stringify(event)).join("\n");
  writeFileSync(join(outDir, "events.ndjson"), `${eventsNdjson}\n`, "utf8");

  if (summary.certificate === undefined) {
    console.error(`✖ لم يصل التشغيل إلى الشهادة — الحالة: ${summary.finalStatus} (${summary.reason ?? "بلا سبب مسجل"})`);
    return summary.finalStatus === "completed" ? 0 : 1;
  }

  const certificatePath = join(outDir, "certificate.json");
  writeFileSync(certificatePath, `${JSON.stringify(summary.certificate, null, 2)}\n`, "utf8");
  const badgePath = join(outDir, "badge.svg");
  mkdirSync(dirname(badgePath), { recursive: true });
  writeFileSync(badgePath, renderBadge(summary.certificate), "utf8");

  if (summary.certificate.granted) {
    console.log(
      `✔ شهادة منححة بدرجة ${summary.certificate.finalScore}/100 — رقم التحقق ${summary.certificate.verificationId}`,
    );
    console.log(`  certificate.json → ${certificatePath}`);
    console.log(`  badge.svg        → ${badgePath}`);
    return 0;
  }
  console.log(`✖ الشهادة مرفوضة بدرجة ${summary.certificate.finalScore}/100 — القرار موثق في certificate.json`);
  return 2;
}
