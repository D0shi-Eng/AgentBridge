import { describe, expect, it } from "vitest";
import type { ToolDesign } from "@agentbridge/shared";
import {
  buildPathTemplateLiteral,
  buildZodShapeLiteral,
  groupParametersByLocation,
  slugifyName,
  zodLiteralFor,
} from "./tool-codegen.js";
import type { FieldDescriptor } from "@agentbridge/shared";

describe("وحدات الكودجن النقية", () => {
  it("slugifyName يوحّد الأسماء إلى معرف آمن ولا يعيد فارغاً أبداً", () => {
    expect(slugifyName("Mini Petstore!")).toBe("mini-petstore");
    // غير اللاتيني يُسقط كلياً فيلجأ للبديل الآمن
    expect(slugifyName("--أ--")).toBe("generated-server");
    expect(slugifyName("###")).toBe("generated-server");
  });

  it("zodLiteralFor يعكس النوع والاختيارية والوصف", () => {
    expect(zodLiteralFor({ type: "string", required: true, description: "d" })).toBe(
      'z.string().describe("d")',
    );
    expect(zodLiteralFor({ type: "number", required: false, description: "d" })).toBe(
      'z.number().describe("d").optional()',
    );
    expect(zodLiteralFor({ type: "boolean", required: false, description: "d" })).toContain(
      "z.boolean()",
    );
  });

  it("buildZodShapeLiteral ينتج كائن شكل صحيحاً ويعيد {} عند الفراغ", () => {
    const design: ToolDesign = {
      name: "x",
      description: "y".repeat(12),
      endpointIds: ["e"],
      parameters: {
        limit: { type: "number", required: false, description: "L" },
      },
    };
    const literal = buildZodShapeLiteral(design);
    expect(literal).toContain('["limit"]: z.number().describe("L").optional()');
    expect(buildZodShapeLiteral({ ...design, parameters: {} })).toBe("{}");
  });

  it("groupParametersByLocation يصنف حسب الحقول الحقيقية ويتجاهل المجهول", () => {
    const fields: FieldDescriptor[] = [
      { pointer: "/p", name: "petId", location: "path", openApiType: "string", required: true },
      { pointer: "/q", name: "limit", location: "query", openApiType: "integer", required: false },
      { pointer: "/r/responses/200/content", name: "respOnly", location: "body", openApiType: "string", required: false },
    ];
    const design: ToolDesign = {
      name: "x",
      description: "y".repeat(12),
      endpointIds: ["e"],
      parameters: {
        petId: { type: "string", required: true, description: "d" },
        limit: { type: "number", required: false, description: "d" },
        ghost: { type: "string", required: false, description: "d" }, // لن يجد موقعه
      },
    };
    // respOnly حقل استجابة — لا يدخل الطلب أصلاً فلا يُطابق
    const grouped = groupParametersByLocation(design, fields.filter((f) => !f.pointer.includes("/responses/")));
    expect(grouped.pathParams).toEqual(["petId"]);
    expect(grouped.queryParams).toEqual(["limit"]);
    expect(grouped.bodyParams).toHaveLength(0);
  });

  it("buildPathTemplateLiteral يولد سلسلة قالب مشفرة للمعاملات", () => {
    const literal = buildPathTemplateLiteral("/pets/{petId}");
    expect(literal.startsWith('"/pets/" +')).toBe(true);
    expect(literal).toContain('encodeURIComponent(String(own(args, "petId") ?? ""))');
    // مسار بلا معاملات يبقى نصاً ثابتاً
    expect(buildPathTemplateLiteral("/health")).toBe('"/health"');
  });
});
