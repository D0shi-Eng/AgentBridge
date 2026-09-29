/**
 * اختبارات مصنّف النقاط — قواعد الأولوية الأربع.
 */

import { describe, expect, it } from "vitest";
import { classifyEndpoint } from "./endpoint-classifier.js";

describe("قواعد التصنيف", () => {
  it("GET على مورد أعمال = قراءة", () => {
    expect(classifyEndpoint("/invoices", "get")).toBe("read");
    expect(classifyEndpoint("/invoices/{id}", "get")).toBe("read");
  });

  it("أفعال الكتابة على مورد أعمال = كتابة", () => {
    expect(classifyEndpoint("/invoices", "post")).toBe("write");
    expect(classifyEndpoint("/invoices/{id}", "delete")).toBe("write");
    expect(classifyEndpoint("/invoices/{id}", "patch")).toBe("write");
  });

  it("مسارات البنية التشغيلية = إدارة بغض النظر عن الفعل", () => {
    expect(classifyEndpoint("/health", "get")).toBe("management");
    expect(classifyEndpoint("/v1/metrics", "get")).toBe("management");
    expect(classifyEndpoint("/status", "post")).toBe("management");
  });

  it("المناطق الإدارية تسبق كل شيء", () => {
    expect(classifyEndpoint("/admin/users", "get")).toBe("admin");
    expect(classifyEndpoint("/internal/queue", "delete")).toBe("admin");
    // حتى لو شابه مقطع بنية، الأولوية للإدارية
    expect(classifyEndpoint("/admin/health", "get")).toBe("admin");
  });

  it("يتجاهل معاملات القالب عند فحص المقاطع", () => {
    expect(classifyEndpoint("/tenants/{tenantId}/reports", "get")).toBe("read");
  });
});
