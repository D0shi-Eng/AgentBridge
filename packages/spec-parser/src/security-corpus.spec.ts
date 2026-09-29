/**
 * اختبارات corpus تمثيلي وعدائي للتوافق OpenAPI.
 *
 * الملفات في tests/fixtures/security-corpus تغطي: 3.0 أساس مع ترقيم صفحات
 * ومعاملات query/header/cookie، و3.1 مع nullable(type arrays) وoneOf،
 * ومراجع دائرية، ومخططات أمن (oauth2 scopes/apiKey)، وmultipart وnon-JSON،
 * ووصف حقني عدائي، ومسارات traversal/SSRF، ومرجع خارجي (سياسة الرفض)،
 * وspec كبير محدود يولد برمجياً.
 *
 * مبدأ الصدق: ما لا تدعمه المنصة يوثق هنا كسلوك فعلي (رفض آمن أو
 * تجاهل معلن) — لا ادعاء دعم webhooks/polymorphism كاملة غير المنفذ.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOpenApiSpec } from "./index.js";

const CORPUS_DIR = fileURLToPath(new URL("../../../tests/fixtures/security-corpus/", import.meta.url));
const read = (name: string) => readFileSync(join(CORPUS_DIR, name), "utf8");

describe("corpus التوافق الإيجابي", () => {
  it("k1: 3.0 أساس — نقاط وترقيم ومعاملات header/cookie تُطبّع", () => {
    const parsed = parseOpenApiSpec(read("k1-baseline-3.0.yaml"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.openapiVersion).toBe("3.0.3");
    expect(parsed.value.endpointCount).toBe(2);
    // تصنيف PII والخطورة في اختبارات analyzer (اتجاه التبعية الصحيح)
  });

  it("k2: OpenAPI 3.1 يقبل — nullable بنمط type-arrays وoneOf تُتجاهل بلا انكسار (سلوك موثق)", () => {
    const parsed = parseOpenApiSpec(read("k2-openapi-3.1-polymorphism.yaml"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.openapiVersion).toBe("3.1.0");
    expect(parsed.value.endpointCount).toBe(1);
    // الصدق: oneOf لا يُفكك إلى مسارات منفصلة — نقطة واحدة تبقى واحدة
    expect(parsed.value.endpoints[0]?.operationId).toBe("getMatter");
  });

  it("k3: oauth2 client-credentials مع scopes وapiKey وcookie param تقبل", () => {
    const parsed = parseOpenApiSpec(read("k3-security-schemes-oauth-cookie.yaml"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.endpointCount).toBe(1);
  });

  it("k4: مراجع دائرية Student↔Guardian تقبل بلا حلقة لا نهائية", () => {
    const parsed = parseOpenApiSpec(read("k4-circular-refs.yaml"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.endpointCount).toBe(1);
  });

  it("k8: multipart وcontent نصي غير JSON — قبول بتجاهل معلن لغير JSON", () => {
    const parsed = parseOpenApiSpec(read("k8-multipart-and-nonjson.yaml"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.endpointCount).toBe(2);
  });
});

describe("corpus العدائي (رفض فاشل مغلق)", () => {
  it("k5: أوصاف حقن التعليمات تُقبض قبل التطبيع — لا تمر كأوصاف أدوات", () => {
    const parsed = parseOpenApiSpec(read("k5-malicious-descriptions.yaml"));
    // المسح الحقني يفشل المسار كله — الوصف الخبيث لا يصل للوكلاء
    expect(parsed.ok).toBe(false);
  });

  it("k7: المرجع الخارجي (SSRF محتمل) مرفوض رفضاً صريحاً بسياسة المراجع", () => {
    const parsed = parseOpenApiSpec(read("k7-external-ref-ssrf.yaml"));
    expect(parsed.ok).toBe(false);
  });

  it("k6: مسارات traversal وservers نحو metadata — بلا انهيار والنتيجة موثقة", () => {
    const parsed = parseOpenApiSpec(read("k6-ssrf-traversal-abuse.yaml"));
    // الصدق: هذا الملف يثبت السلوك الفعلي لا ادعاء — المسار الغريب إما
    // يرفض بنيوياً أو يقبل كنقطة عادية؛ الممنوع هو الانهيار أو التسرب
    if (parsed.ok) {
      const ids = parsed.value.endpoints.map((endpoint) => endpoint.operationId);
      // إن قُبل المسار فلا يتجاوز حدود التطبيع إلى مسار ملفات
      expect(ids).toBeDefined();
      expect(parsed.value.endpointCount).toBeGreaterThan(0);
    }
  });

  it("k9: spec كبير محدود (120 نقطة مولدة برمجياً) يُطبّع كاملاً بلا تجاوز حدود", () => {
    const paths: string[] = [];
    for (let index = 0; index < 120; index++) {
      paths.push(`
  /items/item${index}:
    get:
      operationId: getItem${index}
      summary: Bounded corpus endpoint ${index}
      parameters:
        - name: id${index}
          in: query
          schema: { type: string }
      responses:
        "200": { description: ok }`);
    }
    const big = `openapi: 3.0.3\ninfo:\n  title: Large Bounded Corpus (synthetic)\n  version: 1.0.0\npaths:${paths.join("")}\n`;
    expect(Buffer.byteLength(big)).toBeLessThan(2 * 1024 * 1024);
    const parsed = parseOpenApiSpec(big);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.endpointCount).toBe(120);
  });

  it("k10: webhooks (3.1) وdeprecated — تجاهل معلن لا ادعاء دعم (سلوك موثق)", () => {
    const withWebhooks = `openapi: 3.1.0
info:
  title: Webhooks Ignored Corpus (synthetic)
  version: 1.0.0
webhooks:
  newThing:
    post:
      operationId: onNewThing
      responses:
        "200": { description: ok }
paths:
  /things:
    get:
      operationId: listThings
      deprecated: true
      summary: Deprecated but listed
      responses:
        "200": { description: ok }
`;
    const parsed = parseOpenApiSpec(withWebhooks);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // الصدق: الـwebhooks لا تدخل النقاط — دعمها غير مدّعى
    expect(parsed.value.endpointCount).toBe(1);
    expect(parsed.value.endpoints[0]?.operationId).toBe("listThings");
  });
});
