/**
 * الاختبار التكاملي لحزمة التحليل مع مخرجات الاستيعاب.
 *
 * يثبت حد القبول الرئيسي: مواصفة petstore سليمة تخرج
 * AnalyzedSpec صحيحة بالمحللات الأربعة، وحتمية الخرج الكامل.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOpenApiSpec } from "@agentbridge/spec-parser";
import { analyzeSpec } from "./index.js";

const petstoreYaml = readFileSync(
  new URL("../../../tests/fixtures/mini-petstore.yaml", import.meta.url),
  "utf8",
);

describe("من المواصفة المطبّعة إلى التحليل الكامل", () => {
  const parsed = parseOpenApiSpec(petstoreYaml);
  if (!parsed.ok) throw new Error("تركيبة petstore يجب أن تُستوعب بنجاح");
  const analysis = analyzeSpec(parsed.value);

  it("يصنف الأعمال أعمالاً والبنية بنية", () => {
    expect(analysis.kinds["listPets"]).toBe("read");
    expect(analysis.kinds["createPet"]).toBe("write");
    expect(analysis.kinds["deletePet"]).toBe("write");
    expect(analysis.kinds["getHealth"]).toBe("management");
  });

  it("يكشف PII في جسم الطلب والاستجابة معاً", () => {
    const types = analysis.piiHits.map((h) => h.piiType).sort();
    // ownerPhone (طلب) + vetContactEmail (متداخل) + ownerCreditCard (استجابة)
    expect(types).toContain("phone");
    expect(types).toContain("email");
    expect(types).toContain("financial");
  });

  it("يحسب الخطورة وفق النقاط الفعلية لكل عملية", () => {
    // إنشاء بحقول PII: أساس 2 + PII مرتفع 2 = عالية
    expect(analysis.risks["createPet"]).toBe("high");
    // حذف نظيف بلا PII: أساس 3 = متوسطة
    expect(analysis.risks["deletePet"]).toBe("medium");
    // قائمة تحمل بطاقة في استجابتها: قراءة 1 + PII مرتفع 2 = متوسطة
    expect(analysis.risks["listPets"]).toBe("medium");
    // نبض الصحة: قراءة نظيفة
    expect(analysis.risks["getHealth"]).toBe("low");
  });

  it("يستبعد البنية التشغيلية من مرشحات أدوات MCP", () => {
    expect(analysis.mcpWorthyIds).toEqual(["listPets", "createPet", "showPetById", "deletePet"]);
  });

  it("حتمية كاملة: تشغيلا متتاليان ينتجان التحليل نفسه حرفياً", () => {
    const again = analyzeSpec(parsed.value);
    expect(again).toEqual(analysis);
  });
});
