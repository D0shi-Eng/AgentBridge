import { readFileSync } from "node:fs";

import { parseOpenApiSpec } from "@agentbridge/spec-parser";
import { analyzeSpec } from "@agentbridge/analyzer";
import type { AnalyzedSpec, NormalizedSpec, ToolDesign } from "@agentbridge/shared";


const petstoreYaml = readFileSync(
  new URL("../../../tests/fixtures/mini-petstore.yaml", import.meta.url),
  "utf8",
);

/** تحليل petstore الكامل — للسيناريو السليم */
const parsed = parseOpenApiSpec(petstoreYaml);
if (!parsed.ok) throw new Error("تركيبة petstore يجب أن تُستوعب بنجاح");
export const analyzed: AnalyzedSpec = analyzeSpec(parsed.value);

/** تصميمان سليمان مرجعيان */
export const designs: ToolDesign[] = [
  {
    name: "list_pets",
    description: "List all pets in the store with an optional limit.",
    endpointIds: ["listPets"],
    parameters: {
      limit: { type: "number", required: false, description: "Max pets to return." },
    },
  },
  {
    name: "get_pet_by_id",
    description: "Retrieve one pet by its unique identifier.",
    endpointIds: ["showPetById"],
    parameters: {
      petId: { type: "string", required: true, description: "Pet identifier." },
    },
  },
];

/** مواصفة مصغرة يدوية لأخطاء المدخلات (بلا اعتماد على fixtures) */
export function tinyAnalyzed(fields: NormalizedSpec["endpoints"][number]["fields"]): AnalyzedSpec {
  const spec: NormalizedSpec = {
    title: "Tiny",
    openapiVersion: "3.0.3",
    endpointCount: 1,
    endpoints: [
      {
        path: "/things/{id}",
        method: "get",
        operationId: "getThing",
        summary: "Get a thing",
        pathParams: ["id"],
        requiresAuth: false,
        security: { alternatives: [], source: "none", unsupported: [] },
        fields,
      },
    ],
  };
  return { spec, kinds: {}, risks: {}, piiHits: [], mcpWorthyIds: ["getThing"] };
}

