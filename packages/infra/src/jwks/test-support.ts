/** تجهيز شبكة اصطناعية للاختبارات فقط؛ التوقيع والمخطط والسياسة الإنتاجية تبقى فعلية. */
import { beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import * as resolver from "./resolver.js";
import * as transport from "./transport.js";

export function setupJwksNetwork(): void {
  beforeEach(() => {
    vi.stubEnv("JWKS_ALLOWED_HOSTS", "issuer.example.com,jwks.example.com");
    vi.spyOn(resolver, "resolveDestination").mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.spyOn(transport, "requestJwks").mockRejectedValue(new Error("Unconfigured test transport"));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
}

export function mockJwks(value: unknown): void {
  vi.spyOn(transport, "requestJwks").mockResolvedValue(Buffer.from(JSON.stringify(value)));
}

export function mockJwksFailure(): void {
  vi.spyOn(transport, "requestJwks").mockRejectedValue(new Error("Private network detail must not escape"));
}

let cached: { publicKey: Record<string, unknown>; privateKey: Record<string, unknown> } | undefined;
export function getTestKeyPair() {
  if (!cached) {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    cached = { publicKey: pair.publicKey.export({ format: "jwk" }), privateKey: pair.privateKey.export({ format: "jwk" }) };
  }
  return cached;
}
