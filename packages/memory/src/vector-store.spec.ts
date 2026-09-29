/** اختبارات L3: الحتمية والمفتاح غير الملتبس والعزل الإلزامي. */
import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMS, EMBEDDING_VERSION, cosine, createInMemoryVectorStore, embedText } from "./vector-store.js";
import { testContext } from "./test-tenant-context.js";

const doc = (tenantId: string, id: string, namespace: "spec" | "tool" = "spec") => ({ id, tenantId, namespace, vector: embedText(id), metadata: { title: id, embeddingVersion: EMBEDDING_VERSION, provenance: "pipeline" } });

describe("VectorStore", () => {
  it("التضمين حتمي وcosine يحترم الأبعاد", () => {
    expect(embedText("List PETS")).toEqual(embedText("list pets"));
    expect(embedText("pets")).toHaveLength(EMBEDDING_DIMS);
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
  });

  it("يعزل tenant وnamespace حتى مع الفواصل والبادئات", async () => {
    const store = createInMemoryVectorStore();
    await store.upsert(testContext("a:b"), doc("a:b", "c:d"));
    await store.upsert(testContext("a"), doc("a", "b:c:d", "tool"));
    expect(await store.search(testContext("a:b"), "spec", embedText("c:d"), 5)).toHaveLength(1);
    expect(await store.search(testContext("a"), "spec", embedText("c:d"), 5)).toHaveLength(0);
  });

  it("يرفض نقل مستند بين سياقين ويحذف داخل السياق فقط", async () => {
    const store = createInMemoryVectorStore();
    await expect(store.upsert(testContext("a"), doc("b", "x"))).rejects.toThrow(/لا يطابق/u);
    await store.upsert(testContext("a"), doc("a", "x"));
    await store.remove(testContext("b"), "spec", "x");
    expect(await store.search(testContext("a"), "spec", embedText("x"), 5)).toHaveLength(1);
    await store.remove(testContext("a"), "spec", "x");
    expect(await store.search(testContext("a"), "spec", embedText("x"), 5)).toHaveLength(0);
  });

  it("يرفض أبعاداً وmetadata تتجاوز الحد", async () => {
    const store = createInMemoryVectorStore();
    await expect(store.upsert(testContext("a"), { ...doc("a", "bad"), vector: [1] })).rejects.toThrow(/الأبعاد/u);
    await expect(store.upsert(testContext("a"), { ...doc("a", "bad"), metadata: { embeddingVersion: EMBEDDING_VERSION, provenance: "pipeline", x: "x".repeat(201) } })).rejects.toThrow(/لا نص خام/u);
  });
});
