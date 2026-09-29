/**
 * اختبارات مخزن السياق — التقاط snapshot والاستئناف وكشف العبث.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PipelineContext } from "./context-store.js";

function sampleContext(): PipelineContext {
  const context = new PipelineContext("run-1", "tenant-1");
  context.data.rawSpec = "openapi: 3.0.0";
  context.statuses.set("load_spec", "completed");
  context.statuses.set("normalize", "running");
  context.repairCyclesUsed = 1;
  return context;
}

describe("PipelineContext", () => {
  it("كل المراحل تبدأ pending بالترتيب التنفيذي الثماني", () => {
    const context = new PipelineContext("r", "t");
    expect([...context.statuses.values()]).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(context.firstNonCompleted()).toBe("load_spec");
  });

  it("التقاط snapshot ثم الاستئناف يعيد الحالة والبيانات حرفياً", () => {
    const snapshot = sampleContext().toSnapshot();
    const restored = PipelineContext.fromSnapshot(snapshot);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.runId).toBe("run-1");
    expect(restored.value.tenantId).toBe("tenant-1");
    expect(restored.value.data.rawSpec).toBe("openapi: 3.0.0");
    expect(restored.value.statuses.get("load_spec")).toBe("completed");
    expect(restored.value.repairCyclesUsed).toBe(1);
  });

  it("تعديل بايت واحد في الsnapshot يكشفه فحص البصمة", () => {
    const snapshot = sampleContext().toSnapshot();
    const tampered = JSON.parse(snapshot) as Record<string, unknown>;
    tampered["repairCyclesUsed"] = 99;
    const result = PipelineContext.fromSnapshot(JSON.stringify(tampered));
    expect(!result.ok && result.error.message).toContain("بصمة");
  });

  it("snapshot ليس JSON يرفض برسالة عربية", () => {
    const result = PipelineContext.fromSnapshot("{broken");
    expect(!result.ok && result.error.message).toContain("JSON");
  });

  it("snapshot بعقد إصدار مغاير يرفض قبل أي تنفيذ", () => {
    const snapshot = sampleContext().toSnapshot();
    const foreign = JSON.parse(snapshot) as Record<string, unknown>;
    foreign["version"] = 999;
    delete foreign["integrity"];
    const result = PipelineContext.fromSnapshot(JSON.stringify(foreign));
    expect(result.ok).toBe(false);
  });

  it("حقل data غير معروف يرفض حتى لو سليمة البصمة", () => {
    // نبني snapshot يدوياً بحقول صحيحة وبصمة محسوبة لكن بحقل مهرب
    const body = {
      version: 1,
      runId: "run-1",
      tenantId: "tenant-1",
      createdAt: "2026-08-24T00:00:00Z",
      statuses: { load_spec: "completed" },
      repairCyclesUsed: 0,
      data: { smuggledField: { anything: true } },
    };
    const integrity = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const result = PipelineContext.fromSnapshot(JSON.stringify({ ...body, integrity }));
    expect(!result.ok && result.error.message).toContain("حقل data غير معروف");
  });

  it("حقل معروف لا يطابق مخططه الموثق يرفض", () => {
    const context = new PipelineContext("run-1", "tenant-1");
    context.data.normalized = { title: "", openapiVersion: "bad", endpointCount: -1, endpoints: [] };
    const parsedBody = JSON.parse(context.toSnapshot()) as Record<string, unknown>;
    delete parsedBody["integrity"]; // نعيد حسابها ليصل الفحص إلى بوابة المخطط
    const integrity = createHash("sha256").update(JSON.stringify(parsedBody)).digest("hex");
    const result = PipelineContext.fromSnapshot(JSON.stringify({ ...parsedBody, integrity }));
    expect(!result.ok && result.error.message).toContain("لا يطابق مخططه");
  });

  it("استئناف ببيانات مراحل حقيقية (normalized/analyzed) يعبر بوابة المخططات ويعاد بناؤه", async () => {
    const { parseOpenApiSpec } = await import("@agentbridge/spec-parser");
    const { analyzeSpec } = await import("@agentbridge/analyzer");
    const parsed = parseOpenApiSpec(
      [
        "openapi: \"3.0.3\"",
        "info:",
        "  title: Snapshot Test",
        "  version: \"1.0.0\"",
        "paths:",
        "  /pets:",
        "    get:",
        "      operationId: listPets",
        "      summary: List pets",
        "      responses:",
        "        \"200\":",
        "          description: ok",
      ].join("\n"),
    );
    if (!parsed.ok) throw new Error(`تركيبة الاختبار فاسدة: ${parsed.error.message}`);
    const analyzed = analyzeSpec(parsed.value);
    const context = new PipelineContext("run-1", "tenant-1");
    context.data.rawSpec = "openapi";
    context.data.normalized = analyzed.spec;
    context.data.analyzed = analyzed;
    context.statuses.set("analyze", "completed");

    const restored = PipelineContext.fromSnapshot(context.toSnapshot());
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.data.analyzed?.mcpWorthyIds.length).toBeGreaterThan(0);
    expect(restored.value.statuses.get("analyze")).toBe("completed");
  });
});
