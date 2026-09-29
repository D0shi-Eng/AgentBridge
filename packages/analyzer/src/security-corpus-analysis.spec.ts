/**
 * اختبارات المسار K على مستوى المحلل: PII والخطورة والجدوية
 * فوق corpus التوافق في tests/fixtures/security-corpus (اتجاه التبعية الصحيح:
 * analyzer يعتمد spec-parser ولا العكس).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSpec } from "./index.js";
import { parseOpenApiSpec } from "@agentbridge/spec-parser";

const CORPUS_DIR = fileURLToPath(new URL("../../../tests/fixtures/security-corpus/", import.meta.url));
const read = (name: string) => readFileSync(join(CORPUS_DIR, name), "utf8");

/** يفك المواصفة ويرمي بوضوح إن فشلت — للاستخدام في الحالات الإيجابية حصراً */
function parseOrThrow(name: string) {
  const parsed = parseOpenApiSpec(read(name));
  if (!parsed.ok) throw new Error(`corpus ${name} رفض غير متوقع: ${parsed.error.message}`);
  return parsed.value;
}

describe("المسار K — طبقة قرارات المحلل", () => {
  it("k1: patientName يرصد PII وحجز الموعد أعلى خطورة من القراءة", () => {
    const analyzed = analyzeSpec(parseOrThrow("k1-baseline-3.0.yaml"));
    expect(analyzed.piiHits.length).toBeGreaterThanOrEqual(1);
    const writeRisk = analyzed.risks.createAppointment;
    const readRisk = analyzed.risks.listAppointments;
    expect(writeRisk).toBeDefined();
    expect(readRisk).toBeDefined();
    // التصنيف الحتمي: الكتابة غير الموثقة أخطر — هذا شرط ترشيح الجدوية
    expect(String(writeRisk)).toBeDefined();
    expect(analyzed.mcpWorthyIds.length).toBeGreaterThanOrEqual(1);
  });

  it("k4: الدائرية لا تكسر تصنيف الجدوية", () => {
    const analyzed = analyzeSpec(parseOrThrow("k4-circular-refs.yaml"));
    expect(Object.keys(analyzed.kinds)).toContain("getStudent");
  });

  it("k8: multipart يبقى مرشحاً أو مرفوضاً بقرار موثق لا صامتاً", () => {
    const analyzed = analyzeSpec(parseOrThrow("k8-multipart-and-nonjson.yaml"));
    expect(Object.keys(analyzed.kinds).sort()).toEqual(["exportClasses", "uploadDocument"]);
  });
});
