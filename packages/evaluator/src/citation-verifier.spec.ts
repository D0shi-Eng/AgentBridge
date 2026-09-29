/**
 * اختبارات موثق المصادر — البوابة 3: بلا مرجع = غير موجود.
 */

import { describe, expect, it } from "vitest";
import type { AnalyzedSpec, ToolDesign } from "@agentbridge/shared";
import { verifyCitations } from "./citation-verifier.js";

const analyzed: AnalyzedSpec = {
  spec: {
    title: "Clinic",
    openapiVersion: "3.0.0",
    endpointCount: 2,
    endpoints: [
      {
        path: "/patients/{id}",
        method: "get",
        operationId: "getPatient",
        summary: "Returns one patient",
        pathParams: ["id"],
        requiresAuth: true,
        security: { alternatives: [{ schemes: [{ name: "bearerAuth", scopes: [] }] }], source: "global", unsupported: [] },
        fields: [
          { pointer: "/paths/~1patients~1{id}/get/parameters/0", name: "id", location: "path", openApiType: "string", required: true },
        ],
      },
      {
        path: "/patients",
        method: "post",
        operationId: "createPatient",
        summary: "Creates a patient",
        pathParams: [],
        requiresAuth: true,
        security: { alternatives: [{ schemes: [{ name: "bearerAuth", scopes: [] }] }], source: "global", unsupported: [] },
        fields: [
          { pointer: "/paths/~1patients/post/requestBody/name", name: "name", location: "body", openApiType: "string", required: true },
        ],
      },
    ],
  },
  kinds: {},
  risks: {},
  piiHits: [],
  mcpWorthyIds: ["getPatient", "createPatient"],
};

describe("verifyCitations", () => {
  it("تصاميم م grounded بالكامل تمر بلا مخالفات", () => {
    const designs: ToolDesign[] = [
      {
        name: "get_patient_by_id",
        description: "Retrieve a patient by identifier.",
        endpointIds: ["getPatient"],
        parameters: { id: { type: "string", required: true, description: "Patient id." } },
      },
    ];
    const report = verifyCitations(designs, analyzed);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.checkedTools).toBe(1);
    expect(report.value.violations).toHaveLength(0);
  });

  it("مرجع endpoint غير موجود يلتقط كادعاء بلا مصدر", () => {
    const designs: ToolDesign[] = [
      {
        name: "ghost_tool",
        description: "Claims to do something impossible.",
        endpointIds: ["noSuchOperation"],
        parameters: {},
      },
    ];
    const report = verifyCitations(designs, analyzed);
    if (!report.ok) return;
    expect(report.value.violations.some((violation) => violation.detail.includes("noSuchOperation"))).toBe(true);
  });

  it("نقطة غير مرشحة mcpWorthy ترفض حتى لو موجودة", () => {
    const specWithoutWorthy: AnalyzedSpec = { ...analyzed, mcpWorthyIds: [] };
    const designs: ToolDesign[] = [
      {
        name: "get_patient_by_id",
        description: "Retrieve a patient by identifier.",
        endpointIds: ["getPatient"],
        parameters: {},
      },
    ];
    const report = verifyCitations(designs, specWithoutWorthy);
    if (!report.ok) return;
    expect(report.value.violations.length).toBe(1);
    expect(report.value.violations[0]?.detail).toContain("لم ترشحها");
  });

  it("معامل ليس حقلاً طلب معروفاً يرفض (هلوسة معامل)", () => {
    const designs: ToolDesign[] = [
      {
        name: "create_patient",
        description: "Create a new patient record.",
        endpointIds: ["createPatient"],
        parameters: {
          name: { type: "string", required: true, description: "Name." },
          ageGuess: { type: "number", required: false, description: "مخترع." },
        },
      },
    ];
    const report = verifyCitations(designs, analyzed);
    if (!report.ok) return;
    expect(report.value.violations.some((violation) => violation.detail.includes("ageGuess"))).toBe(true);
  });

  it("معامل مسار اختياري يرفض لأن المسار ينكسر بدونه", () => {
    const designs: ToolDesign[] = [
      {
        name: "get_patient_by_id",
        description: "Retrieve a patient by identifier.",
        endpointIds: ["getPatient"],
        parameters: { id: { type: "string", required: false, description: "Patient id." } },
      },
    ];
    const report = verifyCitations(designs, analyzed);
    if (!report.ok) return;
    expect(report.value.violations.some((violation) => violation.detail.includes("ينكسر"))).toBe(true);
  });
});
