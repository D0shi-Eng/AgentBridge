/**
 * اختبارات أداة simulate_tool_call — قابلية بناء النداء الجاف حتمياً.
 */

import { describe, expect, it } from "vitest";
import type { AnalyzedSpec, ToolDesign } from "@agentbridge/shared";
import { createSimulateToolCallTool } from "./simulate-tool-call.js";

const analyzed: AnalyzedSpec = {
  spec: {
    title: "Petstore",
    openapiVersion: "3.0.0",
    endpointCount: 2,
    endpoints: [
      {
        path: "/pets/{petId}",
        method: "get",
        operationId: "showPetById",
        summary: "Returns a pet by ID",
        pathParams: ["petId"],
        requiresAuth: false,
        security: { alternatives: [], source: "none" as const, unsupported: [] },
        fields: [
          {
            pointer: "/paths/~1pets~1{petId}/get/parameters/0",
            name: "petId",
            location: "path",
            openApiType: "string",
            required: true,
          },
        ],
      },
      {
        path: "/pets",
        method: "post",
        operationId: "createPet",
        summary: "Creates a pet",
        pathParams: [],
        requiresAuth: false,
        security: { alternatives: [], source: "none" as const, unsupported: [] },
        fields: [
          {
            pointer: "/paths/~1pets/post/requestBody/name",
            name: "name",
            location: "body",
            openApiType: "string",
            required: true,
          },
          {
            pointer: "/paths/~1pets/post/requestBody/tag",
            name: "tag",
            location: "query",
            openApiType: "string",
            required: false,
          },
        ],
      },
    ],
  },
  kinds: {},
  risks: {},
  piiHits: [],
  mcpWorthyIds: ["showPetById", "createPet"],
};

const designs: ToolDesign[] = [
  {
    name: "get_pet_by_id",
    description: "Retrieve one pet by its unique identifier.",
    endpointIds: ["showPetById"],
    parameters: { petId: { type: "string", required: true, description: "Pet id." } },
  },
  {
    name: "create_pet",
    description: "Create a new pet record with a required name.",
    endpointIds: ["createPet"],
    parameters: {
      name: { type: "string", required: true, description: "Pet name." },
      tag: { type: "string", required: false, description: "Optional tag." },
    },
  },
];

describe("simulate_tool_call", () => {
  it("خطة نداء سليمة تُبنى بترميز معاملات المسار", async () => {
    const tool = createSimulateToolCallTool(designs, analyzed);
    const result = await tool.execute(
      { toolName: "get_pet_by_id", args: { petId: "../../evil" } },
      { tenantId: "t1" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constructible).toBe(true);
    expect(result.value.method).toBe("GET");
    expect(result.value.url).toContain("..%2F..%2Fevil");
  });

  it("أداة غير موجودة تعيد إشكالية unknown_tool دون بناء خطة", async () => {
    const tool = createSimulateToolCallTool(designs, analyzed);
    const result = await tool.execute({ toolName: "nope", args: {} }, { tenantId: "t1" });
    expect(result.ok && !result.value.constructible && result.value.issues[0]?.kind === "unknown_tool").toBe(true);
  });

  it("معامل إلزامي ناقص يُكشف", async () => {
    const tool = createSimulateToolCallTool(designs, analyzed);
    const result = await tool.execute({ toolName: "get_pet_by_id", args: {} }, { tenantId: "t1" });
    expect(result.ok && result.value.issues.some((issue) => issue.kind === "missing_required")).toBe(true);
  });

  it("عدم تطابق النوع يُكشف (رقم مكان نص)", async () => {
    const tool = createSimulateToolCallTool(designs, analyzed);
    const result = await tool.execute(
      { toolName: "get_pet_by_id", args: { petId: 42 } },
      { tenantId: "t1" },
    );
    expect(result.ok && result.value.issues.some((issue) => issue.kind === "type_mismatch")).toBe(true);
  });

  it("معامل زائد عن التصميم يُكشف كتخمين", async () => {
    const tool = createSimulateToolCallTool(designs, analyzed);
    const result = await tool.execute(
      { toolName: "get_pet_by_id", args: { petId: "x", hacker: true } },
      { tenantId: "t1" },
    );
    expect(result.ok && result.value.issues.some((issue) => issue.kind === "unknown_parameter")).toBe(true);
  });

  it("query يصل خريطة الاستعلام وbody بمفاتيحه", async () => {
    const tool = createSimulateToolCallTool(designs, analyzed);
    const result = await tool.execute(
      { toolName: "create_pet", args: { name: "Rex", tag: "cute" } },
      { tenantId: "t1" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constructible).toBe(true);
    expect(result.value.query).toEqual({ tag: "cute" });
    expect(result.value.bodyKeys).toEqual(["name"]);
  });

  it("مدخل مخالف يرفض قبل التنفيذ", async () => {
    const tool = createSimulateToolCallTool(designs, analyzed);
    // مدخل مقصود الفساد — التحويل مبرر لاختبار البوابة نفسها
    const result = await tool.execute(
      { toolName: "" } as unknown as { toolName: string; args: Record<string, string | number | boolean> },
      { tenantId: "t1" },
    );
    expect(result.ok).toBe(false);
  });
});
