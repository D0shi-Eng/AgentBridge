/**
 * رحلة واقعية كاملة عبر الشبكة — مشروطة بمفتاح حقيقي.
 *
 * تعمل فقط عند ANTHROPIC_API_KEY أو OPENAI_API_KEY مضبوطة، وإلا skip موثق.
 * تستعمل crm-clinic.yaml عبر LLM_PROVIDER=anthropic/openai وتتحقق شهادة ≥85.
 * قد تختلف الدرجة عن 98/100 الحتمية لكن ≥85 ملزمة.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
const OPENAI_KEY = process.env.OPENAI_API_KEY?.trim() ?? "";
// مفاتيح وهمية (fake/test/dummy) تُعامل كمفقودة — لا نداء شبكي حقيقي بها
function isRealKey(value: string): boolean {
  if (value.length === 0) return false;
  const lowered = value.toLowerCase();
  if (lowered.includes("fake") || lowered.includes("dummy") || lowered.includes("test")) return false;
  return true;
}
const hasAnthropic = isRealKey(ANTHROPIC_KEY);
const hasOpenai = isRealKey(OPENAI_KEY);
const hasAnyKey = hasAnthropic || hasOpenai;

if (!hasAnyKey) {
  console.info("[تخطٍّ موثق] رحلة الشبكة المشروطة: لا ANTHROPIC_API_KEY ولا OPENAI_API_KEY حقيقيتان — تتخطى بلا كسر");
}

const crmSpecPath = join(process.cwd(), "tests", "fixtures", "crm-clinic.yaml");
let crmSpec: string;
try {
  crmSpec = readFileSync(crmSpecPath, "utf8");
} catch {
  crmSpec = "";
}

describe.skipIf(!hasAnyKey)("Network provider — رحلة واقعية عبر الشبكة", () => {
  it("crm-clinic.yaml عبر الشبكة ينتج شهادة ≥85", async () => {
    const providerName = hasAnthropic ? "anthropic" : "openai";
    const apiKey = hasAnthropic ? ANTHROPIC_KEY : OPENAI_KEY;

    const { AnthropicProvider } = await import("@agentbridge/llm");
    const { OpenAIProvider } = await import("@agentbridge/llm");
    const { PipelineOrchestrator } = await import("@agentbridge/orchestrator");

    const provider =
      providerName === "anthropic" ? new AnthropicProvider(apiKey) : new OpenAIProvider(apiKey);

    const runId = `network-${Date.now()}`;
    const orchestrator = new PipelineOrchestrator({
      runId,
      tenantId: "network-tenant",
      rawSpec: crmSpec,
      provider,
      harden: { workDir: join(process.cwd(), ".tmp-network"), liveProbes: false },
    });

    const summary = await orchestrator.run();

    expect(summary.certificate).toBeDefined();
    expect(summary.certificate!.finalScore).toBeGreaterThanOrEqual(85);
    expect(summary.certificate!.granted).toBe(true);
  }, 120_000);
});
