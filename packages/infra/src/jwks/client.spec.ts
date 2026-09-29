/** اختبار العميل الإنتاجي عبر المنافذ الداخلية: الوجهات المرفوضة لا تصل للنقل. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createJwksClient, fetchJwks } from "./client.js";
import { JWKS_LIMITS } from "./policy.js";
import { isIP } from "node:net";

const PUBLIC = { address: "93.184.216.34", family: 4 as const };
const JWKS = { keys: [{ kty: "RSA", kid: "key", n: "a".repeat(342), e: "AQAB" }] };
const BODY = Buffer.from(JSON.stringify(JWKS));
const HOSTS = ["idp.example"];
const URL = "https://idp.example/keys";
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("جلب JWKS", () => {
  it("يربط النقل بالعنوان المفحوص ولا يعيد DNS عند تبدل resolver", async () => {
    const resolver = vi.fn().mockResolvedValueOnce([PUBLIC]).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const transport = vi.fn().mockResolvedValue(BODY);
    const client = createJwksClient(resolver, transport);
    expect(await client(URL, HOSTS)).toEqual(JWKS);
    expect(transport.mock.calls[0]?.[1]).toEqual(PUBLIC);
    await expect(client(URL, HOSTS)).rejects.toThrow();
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(["127.0.0.1", "169.254.169.254", "10.0.0.1", "::1", "fd00::1", "::ffff:7f00:1"])(
    "يرفض DNS المختلط قبل الاتصال: %s", async (address) => {
      const transport = vi.fn();
      const resolver = vi.fn().mockResolvedValue([PUBLIC, { address, family: isIP(address) }]);
      await expect(createJwksClient(resolver, transport)(URL, HOSTS)).rejects.toThrow();
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it("يرفض DNS الفارغ والفاشل والعنوان غير المتطابق مع family", async () => {
    const transport = vi.fn();
    for (const addresses of [[], [{ address: "8.8.8.8", family: 6 }], Array(65).fill(PUBLIC)]) {
      await expect(createJwksClient(vi.fn().mockResolvedValue(addresses), transport)(URL, HOSTS)).rejects.toThrow();
    }
    await expect(createJwksClient(vi.fn().mockRejectedValue(new Error("private")), transport)(URL, HOSTS)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("المهلة تشمل DNS وتلغي النقل المتأخر", async () => {
    vi.useFakeTimers();
    let finish: ((value: readonly typeof PUBLIC[]) => void) | undefined;
    const resolver = vi.fn(() => new Promise<readonly typeof PUBLIC[]>((resolve) => { finish = resolve; }));
    const transport = vi.fn();
    const result = createJwksClient(resolver, transport)(URL, HOSTS);
    const assertion = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(JWKS_LIMITS.timeoutMs);
    await assertion;
    finish?.([PUBLIC]);
    await Promise.resolve();
    expect(transport).not.toHaveBeenCalled();
  });
  it("يلغي طلبًا جاريًا أو ملغى مسبقًا ويحد التزامن", async () => {
    const abort = new AbortController();
    const transport = vi.fn(() => new Promise<Buffer>(() => undefined));
    const client = createJwksClient(async () => [PUBLIC], transport);
    const requests = Array.from({ length: 8 }, () => client(URL, HOSTS, abort.signal));
    const assertions = requests.map((request) => expect(request).rejects.toThrow());
    await expect(client(URL, HOSTS)).rejects.toThrow();
    abort.abort();
    await Promise.all(assertions);
    await expect(client(URL, HOSTS, abort.signal)).rejects.toThrow();
  });
  it.each(["invalid json", "null", '{}', '{"keys":[]}', JSON.stringify({ keys: Array(33).fill(JWKS.keys[0]) }),
    JSON.stringify({ keys: [{ ...JWKS.keys[0], d: "private" }] }),
    JSON.stringify({ keys: [{ ...JWKS.keys[0], n: "short" }] }),
    JSON.stringify({ keys: [JWKS.keys[0], JWKS.keys[0]] }), " ".repeat(262145)])(
    "يرفض JSON أو مخطط أو حجم غير صالح %#", async (body) => {
      await expect(createJwksClient(async () => [PUBLIC], async () => Buffer.from(body))(URL, HOSTS)).rejects.toThrow();
    },
  );
  it("المسار العام يرفض غياب إعداد المشغل دون شبكة", async () => {
    vi.stubEnv("JWKS_ALLOWED_HOSTS", "");
    await expect(fetchJwks(URL)).rejects.toThrow("Identity keys could not be verified");
    vi.stubEnv("JWKS_ALLOWED_HOSTS", "*");
    await expect(fetchJwks(URL)).rejects.toThrow("Identity keys could not be verified");
  });
});
