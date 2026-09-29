/**
 * اختبارات مطالب المصمم — عقد المطالبة الموحد بين الحصر والتحصرة.
 * مفصولة عن designer-agent.spec.ts للحفاظ على حدود الملفات.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOpenApiSpec } from "@agentbridge/spec-parser";
import { analyzeSpec } from "@agentbridge/analyzer";
import type { AnalyzedSpec } from "@agentbridge/shared";
import { buildDesignerUserMessage, DESIGNER_SYSTEM_PROMPT } from "./prompts/designer-prompt.js";

const petstoreYaml = readFileSync(
  new URL("../../../tests/fixtures/mini-petstore.yaml", import.meta.url),
  "utf8",
);
const parsedSpec = parseOpenApiSpec(petstoreYaml);
if (!parsedSpec.ok) throw new Error("تركيبة petstore يجب أن تُستوعب بنجاح");
const analyzed: AnalyzedSpec = analyzeSpec(parsedSpec.value);

describe("مطالب المصمم — عقد المطالبة الموحد", () => {
  it("تحوي المطالبة الأقسام الثلاثة الإلزامية وتحصّر البيانات", () => {
    for (const section of ["[الدور]", "[القيود]", "[عقد المخرج]"]) {
      expect(DESIGNER_SYSTEM_PROMPT).toContain(section);
    }
  });

  it("رسالة المستخدم تحصر بيانات المواصفة بين العلامتين الحديتين", () => {
    const message = buildDesignerUserMessage(analyzed);
    expect(message).toContain("<<<SPEC_DATA>>>");
    expect(message).toContain("<<<END_SPEC_DATA>>>");
    // الملخص JSON قابل للفك ويحمل النقاط المرشحة
    const start = message.indexOf("{");
    const end = message.lastIndexOf("}");
    const digest = JSON.parse(message.slice(start, end + 1)) as {
      endpoints: { operationId: string; mcpWorthy: boolean }[];
    };
    expect(digest.endpoints.some((e) => e.mcpWorthy)).toBe(true);
  });
});
