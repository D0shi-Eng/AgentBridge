/** عقد النقل الحقيقي مع HTTPS اصطناعي: لا sockets فعلية ولا تعديل TLS في الإنتاج. */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "node:https";
import type { IncomingMessage } from "node:http";
import { pinnedLookup, requestJwks } from "./transport.js";

vi.mock("node:https", () => ({ request: vi.fn() }));
const destination = { address: "93.184.216.34", family: 4 as const };
let response: PassThrough & { statusCode: number; headers: Record<string, string | undefined> };
let req: EventEmitter & { end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
beforeEach(() => {
  response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
  req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
  vi.mocked(request).mockReset();
  vi.mocked(request).mockImplementation((_url, _options, callback) => {
    queueMicrotask(() => callback?.(response as unknown as IncomingMessage));
    return req as unknown as ReturnType<typeof request>;
  });
});
function start() { return requestJwks(new URL("https://idp.example/keys"), destination, new AbortController().signal, 16); }

describe("HTTPS pinning وحدود التدفق", () => {
  it("يثبت lookup والشهادة وSNI ويعطل pooling ويحفظ hostname", async () => {
    const promise = start();
    await Promise.resolve();
    response.end("{}");
    expect(await promise).toEqual(Buffer.from("{}"));
    expect(vi.mocked(request).mock.calls[0]?.[0]).toEqual(new URL("https://idp.example/keys"));
    expect(vi.mocked(request).mock.calls[0]?.[1]).toMatchObject({
      agent: false, servername: "idp.example", rejectUnauthorized: true, family: 4,
      headers: { "Accept-Encoding": "identity" },
    });
    const callback = vi.fn();
    pinnedLookup(destination)("ignored.example", {}, callback);
    expect(callback).toHaveBeenLastCalledWith(null, destination.address, 4);
    pinnedLookup(destination)("ignored.example", { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, [destination]);
  });
  it.each([301, 302, 307, 308, 404, 500])("يرفض HTTP %s دون redirect", async (status) => {
    response.statusCode = status;
    response.headers.location = "https://127.0.0.1/";
    await expect(start()).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    expect(req.destroy).toHaveBeenCalled();
  });
  it.each([{ "content-encoding": "gzip" }, { "content-encoding": "br" },
    { "content-length": "17" }, { "content-length": "invalid" }])("يرفض الرأس غير الآمن %j", async (headers) => {
    response.headers = headers;
    await expect(start()).rejects.toThrow();
    expect(response.destroyed).toBe(true);
  });
  it("يقطع chunked قبل تجميع البايتات الزائدة ولا يثق بطول كاذب", async () => {
    response.headers["content-length"] = "2";
    const promise = start();
    const assertion = expect(promise).rejects.toThrow();
    await Promise.resolve();
    response.write(Buffer.alloc(10));
    response.write(Buffer.alloc(10));
    await assertion;
    expect(response.destroyed).toBe(true);
  });
  it("يمرر الإلغاء للنقل وينظف أخطاء الاتصال والقراءة", async () => {
    const promise = start();
    const assertion = expect(promise).rejects.toThrow("Identity keys could not be verified");
    req.emit("error", new Error("private hostname"));
    await assertion;
    const second = start();
    const rejected = expect(second).rejects.toThrow();
    await Promise.resolve();
    response.emit("aborted");
    await rejected;
  });
});
