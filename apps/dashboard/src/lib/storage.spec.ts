import { beforeEach, describe, expect, it } from "vitest";
import { clearLegacyCredentials } from "./storage";

describe("ترحيل التخزين القديم", () => {
  beforeEach(() => localStorage.clear());
  it("يحذف بيانات الاعتماد القديمة دون إنشاء بديل", () => {
    localStorage.setItem("ab.credentials.v1", JSON.stringify({ tenantId: "t1", apiKey: "canary" }));
    clearLegacyCredentials();
    expect(localStorage.getItem("ab.credentials.v1")).toBeNull();
    expect(Object.keys(localStorage)).not.toContain("canary");
  });
});
