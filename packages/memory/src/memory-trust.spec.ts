/**
 * اختبارات أمان الذاكرة L0–L4 — المسار 6: عزل المستأجرين عبر الطبقات،
 * provenance إلزامي يمر مع الاسترجاع، وانقضاء L1 لا يمس المرجع الدائم L2.
 */

import { describe, expect, it } from "vitest";
import { requireTenantContext, type TenantContext } from "@agentbridge/shared";
import {
  createInMemoryEpisodicStore,
  createInMemoryFlywheelStore,
  createInMemoryRunArchiveStore,
  createInMemoryVectorStore,
  EMBEDDING_VERSION,
  embedText,
  type Lesson,
} from "./index.js";

function principalFor(tenantId: string): TenantContext {
  return requireTenantContext({
    tenantId,
    principal: { actorType: "service", authMethod: "api_key", subjectId: `internal:${tenantId}`, credentialId: `internal:${tenantId}`, tenantId, permissions: ["flywheel:read", "flywheel:write"], authorizationVersion: 1 },
  });
}

function lessonFor(tenantId: string, pattern: string, source: "pipeline" | "manual" = "pipeline"): Lesson {
  return { specPattern: pattern, designDecision: `قرار لـ${pattern}`, outcome: "success", score: 90, tenantId, createdAt: "2026-09-18T00:00:00.000Z", source };
}

describe("عزل المستأجرين A/B عبر الطبقات", () => {
  it("L3: A لا يقرأ ولا يبحث في مستندات B — وكتابة B بمفتاح A مرفوضة", async () => {
    const store = createInMemoryVectorStore();
    const a = principalFor("tenant-A");
    const b = principalFor("tenant-B");
    await store.upsert(a, { id: "d1", tenantId: "tenant-A", namespace: "spec", vector: embedText("petstore spec"), metadata: { embeddingVersion: EMBEDDING_VERSION, provenance: "pipeline", title: "A-doc" } });
    // كتابة وثيقة tenant-B تحت سياق A تُرفض
    await expect(store.upsert(a, { id: "d-b", tenantId: "tenant-B", namespace: "spec", vector: embedText("b doc"), metadata: { embeddingVersion: EMBEDDING_VERSION, provenance: "pipeline" } })).rejects.toThrow();
    // بحث A لا يعيد شيئاً من B (وأكد أن d1 يعود لـA)
    const hits = await store.search(a, "spec", embedText("petstore spec"), 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.metadata["title"]).toBe("A-doc");
    // بحث B فارغ
    expect(await store.search(b, "spec", embedText("petstore spec"), 10)).toHaveLength(0);
  });

  it("L4: دروس A لا تظهر في topK/listRecent لـB، وحذف B لا يمس A", async () => {
    const store = createInMemoryFlywheelStore();
    const a = principalFor("tenant-A");
    const b = principalFor("tenant-B");
    await store.saveLesson(a, lessonFor("tenant-A", "pattern-1"));
    const seenByB = await store.topK(b, "pattern-1", 5);
    expect(seenByB).toHaveLength(0);
    const seenByA = await store.topK(a, "pattern-1", 5);
    expect(seenByA).toHaveLength(1);
    // حذف B بمعرف درس A: نطاقه (id+tenant) فلا يمس درس A (سلوك العقد الحالي)
    await store.deleteLesson(b, seenByA[0]?.id ?? "");
    expect(await store.topK(a, "pattern-1", 5)).toHaveLength(1);
  });
});

describe("provenance — المنشأ لا يضيع عند الاسترجاع", () => {
  it("L4: source المعلن مع الدرس يعود كما هو من topK", async () => {
    const store = createInMemoryFlywheelStore();
    const a = principalFor("tenant-A");
    await store.saveLesson(a, lessonFor("tenant-A", "pattern-src", "manual"));
    const hits = await store.topK(a, "pattern-src", 5);
    expect(hits[0]?.source).toBe("manual");
  });

  it("L3: upsert بلا embeddingVersion/provenance مرفوض — وبلهما يعودان في النتائج", async () => {
    const store = createInMemoryVectorStore();
    const a = principalFor("tenant-A");
    await expect(store.upsert(a, { id: "x", tenantId: "tenant-A", namespace: "tool", vector: embedText("t"), metadata: { provenance: "pipeline" } })).rejects.toThrow("embeddingVersion");
    await expect(store.upsert(a, { id: "x", tenantId: "tenant-A", namespace: "tool", vector: embedText("t"), metadata: { embeddingVersion: EMBEDDING_VERSION } })).rejects.toThrow("provenance");
    await store.upsert(a, { id: "x", tenantId: "tenant-A", namespace: "tool", vector: embedText("t"), metadata: { embeddingVersion: EMBEDDING_VERSION, provenance: "pipeline" } });
    const hits = await store.search(a, "tool", embedText("t"), 5);
    expect(hits[0]?.metadata["embeddingVersion"]).toBe(EMBEDDING_VERSION);
    expect(hits[0]?.metadata["provenance"]).toBe("pipeline");
  });
});

describe("انقضاء L1 لا يفقد المرجع الدائم L2", () => {
  it("بعد انتهاء TTL تنطبى الأحداث والحالة من L1 — والأرشيف الدائم يعيد snapshot", async () => {
    let nowMs = 1_000_000;
    const episodic = createInMemoryEpisodicStore({ ttlSeconds: 60, now: () => nowMs });
    const archive = createInMemoryRunArchiveStore({ now: () => new Date(nowMs).toISOString() });
    await episodic.appendEvent("t1", "r1", { runId: "r1", tenantId: "t1", stage: "load_spec", at: new Date(nowMs).toISOString(), summary: "بدأت" });
    await episodic.saveSnapshot("t1", "r1", "{\"signed\":\"envelope-v2\"}");
    await archive.archive({ tenantId: "t1", runId: "r1", snapshotJson: "{\"signed\":\"envelope-v2\"}", generation: 3, fence: 2 });

    nowMs += 120_000; // انقضى عمر L1 (60s)
    expect(await episodic.loadSnapshot("t1", "r1")).toBeNull();
    expect(await episodic.readEvents("t1", "r1")).toHaveLength(0);
    // المرجع الدائم سليم — مدخل الاستئناف بعد TTL
    const restored = await archive.latest("t1", "r1");
    expect(restored?.snapshotJson).toBe("{\"signed\":\"envelope-v2\"}");
    expect(restored?.generation).toBe(3);
  });
});
