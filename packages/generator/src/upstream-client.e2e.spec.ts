/**
 * اختبار وظيفي لعميل upstream المولد — حارس العنوان وسقف القراءة المتدفقة.
 *
 * الملزم: السقف يُطبق أثناء القراءة (413 مع قطع القراءة قبل اكتمال
 * التحميل)، والحارس يرفض عناوين غير آمنة (http خارج loopback، اعتماد
 * مضمّنة في الـURL). الاختبار فوق سوكيت حقيقي على 127.0.0.1 حصراً
 * (حد وثيقة security.md §4) — العميل المولد يُستورد من الملف المولد نفسه.
 */

import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateServer } from "./emitter.js";
import { injectionInput } from "./injection-fixture.js";

/** واجهة العميل المولد كما يستوركها الاختبار من الملف المولد */
interface GeneratedClient {
  callUpstream(config: { upstreamBaseUrl: string; upstreamApiKey?: string }, options: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
  }): Promise<{ status: number; ok: boolean; body: unknown }>;
  assertSafeUpstreamUrl(url: URL): void;
}

describe("عميل upstream المولد — حدود الشبكة والحجم", () => {
  let server: Server;
  let baseUrl: string;
  let client: GeneratedClient;
  let workDir: string;
  /** عدّاد البايتات المرسلة فعلياً قبل قطع الاتصال — يثبت القطع المبكر */
  let bytesSentBeforeClose = 0;

  beforeAll(async () => {
    // توليد artifact حقيقي واستخراج ملف upstream-client.ts منه
    const generated = generateServer(injectionInput("/things/{id}"));
    if (!generated.ok) throw generated.error;
    const clientFile = generated.value.files.find((file) => file.path === "src/upstream-client.ts");
    if (clientFile === undefined) throw new Error("artifact بلا upstream-client");
    // عقد قالب: السقف أثناء القراءة بقارئ تدفقي لا بعد التحميل الكامل
    expect(clientFile.contents).toContain("getReader()");
    expect(clientFile.contents).toContain("MAX_BODY_BYTES");
    expect(clientFile.contents).toContain("reader.cancel()");

    workDir = mkdtempSync(join(tmpdir(), "gen-client-"));
    writeFileSync(join(workDir, "upstream-client.ts"), clientFile.contents);
    const moduleUrl = pathToFileURL(join(workDir, "upstream-client.ts")).toString();
    client = (await import(moduleUrl)) as unknown as GeneratedClient;

    // upstream محلي: /echo يعيد جسماً ضخماً — نعدّ ما أُرسل قبل القطع
    server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      if (request.url?.startsWith("/huge")) {
        const chunk = "x".repeat(64 * 1024);
        let sent = 0;
        // ضخ بطيء (نبضة كل 20ms) — قياس القطع المبكر بدل عدّ المخزن المؤقت
        const pump = setInterval(() => {
          if (response.destroyed || response.writableEnded) { clearInterval(pump); return; }
          response.write(chunk);
          sent += chunk.length;
          if (sent > 8 * 1024 * 1024) { clearInterval(pump); response.end(); }
        }, 20);
        response.once("close", () => { clearInterval(pump); bytesSentBeforeClose = sent; });
        return;
      }
      response.end(JSON.stringify({ small: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("منفذ غير صالح");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("جسم صغير يمر ويُحل JSON", async () => {
    const result = await client.callUpstream({ upstreamBaseUrl: baseUrl }, { method: "GET", path: "/small" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ small: true });
  });

  it("جسم فوق السقف يُرفض 413 والقراءة تُقطع قبل اكتمال التحميل", async () => {
    bytesSentBeforeClose = 0;
    const result = await client.callUpstream({ upstreamBaseUrl: baseUrl }, { method: "GET", path: "/huge" });
    expect(result.status).toBe(413);
    expect(result.ok).toBe(false);
    // القطع المبكر: الخادم لم يضخ أبعد من كثير فوق السقف — لو استهلك العميل
    // كل الجسم لانتظر حتى 8MB (نبضات 20ms × 128) — الحد هنا أعلى بثلاثة
    // أضعاف من سقف القراءة 512KB بفارق آمن للتنويع الزمني
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(bytesSentBeforeClose).toBeGreaterThan(512 * 1024);
    expect(bytesSentBeforeClose).toBeLessThan(2 * 1024 * 1024);
  }, 15_000);

  it("الحارس يرفض http خارج loopback وبيانات الاعتماد المضمنة", () => {
    expect(() => client.assertSafeUpstreamUrl(new URL("http://internal.example.com/api"))).toThrow("UPSTREAM_URL_REJECTED");
    expect(() => client.assertSafeUpstreamUrl(new URL("https://user:secret@example.com/api"))).toThrow("UPSTREAM_URL_REJECTED");
    expect(() => client.assertSafeUpstreamUrl(new URL("ftp://example.com/x"))).toThrow("UPSTREAM_URL_REJECTED");
    // loopback مسموح بـhttp لبيئة الاختبار حصراً
    expect(() => client.assertSafeUpstreamUrl(new URL("http://127.0.0.1:9/x"))).not.toThrow();
  });
});
