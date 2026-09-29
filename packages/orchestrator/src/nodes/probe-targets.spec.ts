/**
 * اختبارات اشتقاق أهداف الفحص الحي — حتمية الاختيار والقيم.
 */

import { describe, expect, it } from "vitest";
import type { AnalyzedSpec, ToolDesign } from "@agentbridge/shared";
import { TRAVERSAL_MARKER } from "@agentbridge/hardening";
import { deriveProbeTargets } from "./probe-targets.js";

function endpoint(operationId: string, path: string, pathParams: readonly string[]) {
  return {
    pointer: "",
    path,
    method: "get",
    operationId,
    summary: `${operationId} summary`,
    pathParams,
    requiresAuth: false,
    security: { alternatives: [], source: "none" as const, unsupported: [] },
    fields: pathParams.map((name) => ({
      pointer: `/paths/${name}`,
      name,
      location: "path" as const,
      openApiType: "string",
      required: true,
    })),
  };
}

const analyzed: AnalyzedSpec = {
  spec: {
    title: "Demo",
    openapiVersion: "3.0.0",
    endpointCount: 2,
    endpoints: [
      endpoint("listThings", "/things", []),
      endpoint("getThing", "/things/{thingId}", ["thingId"]),
    ],
  },
  kinds: {},
  risks: {},
  piiHits: [],
  mcpWorthyIds: ["listThings", "getThing"],
};

const designs: ToolDesign[] = [
  {
    name: "list_things",
    description: "List all things available.",
    endpointIds: ["listThings"],
    parameters: { limit: { type: "number", required: false, description: "Max items." } },
  },
  {
    name: "get_thing_by_id",
    description: "Retrieve one thing by identifier.",
    endpointIds: ["getThing"],
    parameters: { thingId: { type: "string", required: true, description: "Thing id." } },
  },
];

describe("deriveProbeTargets", () => {
  it("يفضل الأداة ذات معامل المسار ويملأ البقية بقيم دليلية", () => {
    const targets = deriveProbeTargets(designs, analyzed);
    expect(targets).toBeDefined();
    expect(targets?.leakTarget.name).toBe("get_thing_by_id");
    expect(targets?.traversalTarget.name).toBe("get_thing_by_id");
    expect(targets?.traversalTarget.args["thingId"]).toBe(`../../${TRAVERSAL_MARKER}`);
    expect(targets?.traversalTarget.expectEncoded).toBe(`..%2F..%2F${TRAVERSAL_MARKER}`);
  });

  it("حمولة الاجتياز لا تلمس أهداف التسريب", () => {
    const targets = deriveProbeTargets(designs, analyzed);
    expect(targets?.leakTarget.args["thingId"]).not.toContain(TRAVERSAL_MARKER);
  });

  it("بلا مرشح مناسب يعيد undefined بصراحة لا تخميناً", () => {
    const noParams: AnalyzedSpec = { ...analyzed, spec: { ...analyzed.spec, endpoints: [endpoint("only", "/only", [])] } };
    const flatDesigns: ToolDesign[] = [
      {
        name: "list_things",
        description: "List all things available.",
        endpointIds: ["only"],
        parameters: {},
      },
    ];
    expect(deriveProbeTargets(flatDesigns, noParams)).toBeUndefined();
  });

  it("قائمة تصاميم فارغة تعيد undefined", () => {
    expect(deriveProbeTargets([], analyzed)).toBeUndefined();
  });
});
