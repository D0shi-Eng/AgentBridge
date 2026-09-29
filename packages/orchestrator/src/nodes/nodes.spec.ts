/**
 * اختبارات عقد المراحل — الحراس البنيوية والفشل المنظم دون نموذج.
 *
 * تكمل مواصفة المحرك: كل حارس "تسلسل مكسور" وكل فرع فشل مبكر
 * يُستدعى هنا مباشرة بسياقات مصنوعة يدوياً — سريعة وحتمية كلياً.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MockLlmProvider } from "@agentbridge/llm";
import { analyzeSpec } from "@agentbridge/analyzer";
import { parseOpenApiSpec } from "@agentbridge/spec-parser";
import type { SecurityReport } from "@agentbridge/shared";
import { PipelineContext } from "../context-store.js";
import {
  createAnalyzeNode,
  createLoadSpecNode,
  createNormalizeNode,
} from "./basic-nodes.js";
import { createDesignToolsNode } from "./design-tools-node.js";
import { createGenerateServerNode } from "./generate-server-node.js";
import { createHardenNode } from "./harden-node.js";
import { createEvaluateNode } from "./evaluate-node.js";
import { createCertifyNode } from "./certify-node.js";
import { createRepairNode } from "./repair-node.js";
import { realSleep } from "../retry-policy.js";

const petstoreYaml = readFileSync(
  fileURLToPath(new URL("../../../../tests/fixtures/mini-petstore.yaml", import.meta.url)),
  "utf8",
);

const VALID_BATCH = [
  {
    name: "list_pets",
    description: "List all pets in the store with an optional limit.",
    endpointIds: ["listPets"],
    parameters: { limit: { type: "number", required: false, description: "Max pets to return." } },
  },
] as const;

function preparedContext(): { context: PipelineContext; analyzed: ReturnType<typeof analyzeSpec> } {
  const context = new PipelineContext("run-nodes", "tenant-nodes");
  const parsed = parseOpenApiSpec(petstoreYaml);
  if (!parsed.ok) throw new Error("fixture يجب أن يُستوعب");
  const analyzed = analyzeSpec(parsed.value);
  context.data.rawSpec = petstoreYaml;
  context.data.normalized = parsed.value;
  context.data.analyzed = analyzed;
  return { context, analyzed };
}

describe("الحراس البنيوية للعقد", () => {
  it("load_spec: نص فارغ يرفض فشلاً نهائياً", async () => {
    const outcome = await createLoadSpecNode(new PipelineContext("r", "t"), { rawSpec: "   " }).run();
    expect(outcome.kind === "failed" && outcome.fatal).toBe(true);
  });

  it("normalize بلا خام يكشف كسر التسلسل", async () => {
    const outcome = await createNormalizeNode(new PipelineContext("r", "t")).run();
    expect(outcome.kind === "failed" && outcome.error.code).toBe("INTERNAL");
  });

  it("analyze بلا مطبّعة يكشف كسر التسلسل", async () => {
    const outcome = await createAnalyzeNode(new PipelineContext("r", "t")).run();
    expect(outcome.kind === "failed" && outcome.error.code).toBe("INTERNAL");
  });

  it("design_tools بلا تحليل يكشف كسر التسلسل", async () => {
    const outcome = await createDesignToolsNode(new PipelineContext("r", "t"), new MockLlmProvider({})).run();
    expect(outcome.kind === "failed" && outcome.fatal).toBe(true);
  });

  it("generate_server بلا تصاميم يكشف كسر التسلسل، وبمدخلات كاملة يكتمل", async () => {
    const broken = await createGenerateServerNode(new PipelineContext("r", "t")).run();
    expect(broken.kind === "failed" && broken.fatal).toBe(true);

    const { context } = preparedContext();
    context.data.designs = [...VALID_BATCH];
    const outcome = await createGenerateServerNode(context).run();
    expect(outcome.kind === "completed").toBe(true);
    expect(context.data.artifact?.toolNames).toEqual(["list_pets"]);
  });

  it("harden بلا artifact يفشل نهائياً، وبفحوص حية بلا مرشح يرفض بصراحة", async () => {
    const broken = await createHardenNode(new PipelineContext("r", "t"), new MockLlmProvider({}), {
      workDir: "unused",
      liveProbes: false,
    }).run();
    expect(broken.kind === "failed" && broken.fatal).toBe(true);

    // تصميم بلا معاملات إطلاقاً + فحوص حية مطلوبة = رفض صريح لا تجاوز صامت
    const flatSpec = parseOpenApiSpec(petstoreYaml);
    if (!flatSpec.ok) throw new Error("unreachable");
    const context = new PipelineContext("r2", "t2");
    context.data.analyzed = analyzeSpec(flatSpec.value);
    context.data.designs = [];
    context.data.artifact = { files: [], toolNames: [] };
    const outcome = await createHardenNode(context, new MockLlmProvider({}), {
      workDir: "unused-too",
      liveProbes: true,
    }).run();
    expect(outcome.kind === "failed" && !outcome.fatal && outcome.error.code).toBe("INVALID_INPUT");
  });

  it("evaluate بلا مدخلات يكشف الكسر، وcertify بلا تقرير كذلك", async () => {
    const evalBroken = await createEvaluateNode(new PipelineContext("r", "t"), new MockLlmProvider({})).run();
    expect(evalBroken.kind === "failed" && evalBroken.fatal).toBe(true);

    const certBroken = await createCertifyNode(new PipelineContext("r", "t")).run();
    expect(certBroken.kind === "failed" && certBroken.fatal).toBe(true);
  });

  it("certify بتقرير سليم ودليل حي يمنح شهادة ويكمل — وبلا دليل يرفض موثقاً", async () => {
    const { context } = preparedContext();
    context.data.designs = [...VALID_BATCH];
    const generated = await createGenerateServerNode(context).run();
    expect(generated.kind).toBe("completed");

    const cleanReport: SecurityReport = {
      findings: [],
      totalChecks: 10,
      passedCount: 10,
      hasCritical: false,
      cleanlinessScore: 100,
    };
    context.data.securityReport = cleanReport;
    context.data.qualityScores = [{ toolName: "list_pets", score: 90, reasons: ["بند إثبات كافٍ"] }];

    // السالب أولاً: بلا دليل فئات حية لا منح مهما بلغت الدرجة
    const withoutEvidence = await createCertifyNode(context).run();
    expect(withoutEvidence.kind === "completed").toBe(true);
    expect(context.data.certificate?.granted).toBe(false);
    expect(context.data.certificate?.notGrantedReason).toContain("فئات حية");

    // الإيجابي: دليل حي خادمي مرتبط ببصمة الـartifact نفسها يفتح المنح
    const artifact = context.data.artifact;
    if (artifact === undefined) throw new Error("التوليد يجب أن يكون قد أنتج artifact");
    const { computeArtifactsHash } = await import("@agentbridge/evaluator");
    context.data.liveProbeEvidence = {
      checksTotal: 6,
      checksPassed: 6,
      probedArtifactsHash: computeArtifactsHash(artifact),
      executedAt: new Date().toISOString(),
    };
    const outcome = await createCertifyNode(context).run();
    expect(outcome.kind === "completed").toBe(true);
    expect(context.data.certificate?.granted).toBe(true);
    // 0.6*100 + 0.4*90 = 96
    expect(context.data.certificate?.finalScore).toBe(96);
  });

  it("repair بلا artifact يفشل نهائياً", async () => {
    const node = createRepairNode(new PipelineContext("r", "t"), new MockLlmProvider({}), {
      stage: "harden",
      summary: "اختبار",
      findings: [],
      attempt: 0,
    });
    const outcome = await node.run();
    expect(outcome.kind === "failed" && outcome.fatal).toBe(true);
  });

  it("realSleep الافتراضي يفي بوعدته فعلاً", async () => {
    await expect(realSleep(1)).resolves.toBeUndefined();
  });
});
