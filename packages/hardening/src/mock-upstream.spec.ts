/**
 * اختبارات upstream المسجل — تغطية كل أشكال الاستجابة مباشرة بلا MCP:
 * نجاح القوائم، نجاح القراءة، الإنشاء 201، والفشل السرّي الافتراضي.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LEAK_MARKER, startRecordingUpstream } from "./mock-upstream.js";

describe("startRecordingUpstream", () => {
  const upstreamPromise = startRecordingUpstream();
  let baseUrl = "";
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const upstream = await upstreamPromise;
    baseUrl = upstream.baseUrl;
    close = async () => {
      upstream.server.closeAllConnections();
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
    };
  });

  afterAll(async () => {
    await close();
  });

  it("القوائم على /pets? تعيد مصفوفة", async () => {
    const response = await fetch(`${baseUrl}/pets?limit=2`);
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(2);
  });

  it("قراءة /pets/:id تعيد حيواناً واحداً", async () => {
    const response = await fetch(`${baseUrl}/pets/9`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "1" });
  });

  it("الإنشاء POST /pets يعيد 201 مع جسم", async () => {
    const response = await fetch(`${baseUrl}/pets`, { method: "POST", body: '{"name":"x"}' });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ created: true });
  });

  it("أي مسار آخر يفشل 500 بجسم يحمل علامة السر", async () => {
    const response = await fetch(`${baseUrl}/internal/diagnostics`);
    expect(response.status).toBe(500);
    const body = (await response.json()) as { secret?: string };
    expect(body.secret).toBe(LEAK_MARKER);
  });

  it("الأهداف الخام تُسجل بترتيب وصولها", async () => {
    const upstream = await upstreamPromise;
    expect(upstream.recordedTargets).toEqual(["/pets?limit=2", "/pets/9", "/pets", "/internal/diagnostics"]);
  });

  it("التسلسل: POST /seq-first يعيد seqId", async () => {
    const response = await fetch(`${baseUrl}/seq-first`, { method: "POST", body: '{"name":"a"}' });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ seqId: "SEQ-77" });
  });

  it("التسلسل: GET /seq-second/:seqId يعيد نفس المعرف", async () => {
    const response = await fetch(`${baseUrl}/seq-second/SEQ-77`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ seqId: "SEQ-77", ok: true });
  });
});
