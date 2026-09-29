/**
 * اختبارات محلل جدوى MCP — قواعد الفلترة الأربع.
 */

import { describe, expect, it } from "vitest";
import { isMcpWorthy } from "./mcp-worthiness.js";
import type { NormalizedEndpoint } from "@agentbridge/shared";

/** مصنع نقطة مطبعة */
function endpoint(partial: Partial<NormalizedEndpoint>): NormalizedEndpoint {
  return {
    path: "/orders",
    method: "get",
    operationId: "listOrders",
    summary: "List orders",
    pathParams: [],
    requiresAuth: true,
    security: { alternatives: [{ schemes: [{ name: "bearerAuth", scopes: [] }] }], source: "global", unsupported: [] },
    fields: [],
    ...partial,
  };
}

describe("قواعد الجدوى", () => {
  it("البنية التشغيلية مرفوضة دائماً حتى لو موثقة", () => {
    expect(isMcpWorthy(endpoint({ path: "/health", summary: "Heartbeat" }), "management")).toBe(false);
  });

  it("القراءة الموثقة مقبولة", () => {
    expect(isMcpWorthy(endpoint({}), "read")).toBe(true);
  });

  it("الكتابة الموثقة مقبولة", () => {
    expect(isMcpWorthy(endpoint({ method: "post", summary: "Create order" }), "write")).toBe(true);
  });

  it("عملية بلا توثيق حقيقي وبلا حقول مرفوضة — أداة غامضة تصنع نداءات خاطئة", () => {
    // الملخص هنا هو القالب الافتراضي نفسه = لا توثيق فعلي
    expect(isMcpWorthy(endpoint({ summary: "GET /orders" }), "read")).toBe(false);
  });

  it("الإدارية غير الموثقة مرفوضة والموثقة مقبولة", () => {
    // الملخص مطابق تماماً للقالب الافتراضي = لا توثيق فعلي
    const undocumented = endpoint({ path: "/admin/purge", method: "delete", summary: "DELETE /admin/purge" });
    expect(isMcpWorthy(undocumented, "admin")).toBe(false);

    const documented = endpoint({ path: "/admin/purge", method: "delete", summary: "Purge expired admin jobs" });
    expect(isMcpWorthy(documented, "admin")).toBe(true);
  });
});
