/** محاكاة DNS وHTTPS الأصليين عبر حدود Node؛ سياسة JWKS والمدقق يظلان فعليين. */
import { beforeEach, afterEach, vi } from "vitest";
import dns from "node:dns/promises";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";

let body: Buffer | undefined;
export function setupJwksNetwork(): void {
  beforeEach(() => {
    body = undefined;
    vi.stubEnv("JWKS_ALLOWED_HOSTS", "issuer.example.com");
    class TestResolver {
      resolve4 = async () => ["93.184.216.34"];
      resolve6 = async () => [];
      cancel = () => undefined;
    }
    // المحاكي يطبق resolve4/resolve6/cancel فقط؛ بقية عقد Resolver غير مستعملة في هذا المسار.
    vi.spyOn(dns, "Resolver").mockImplementation(() => new TestResolver() as unknown as InstanceType<typeof dns.Resolver>);
    vi.spyOn(https, "request").mockImplementation((_url, _options, callback) => {
      const req = Object.assign(new EventEmitter(), { end: () => undefined, destroy: () => undefined });
      queueMicrotask(() => {
        if (!body) { req.emit("error", new Error("Unconfigured test response")); return; }
        const response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
        callback?.(response as unknown as IncomingMessage);
        response.end(body);
      });
      return req as unknown as ReturnType<typeof https.request>;
    });
    syncBuiltinESMExports();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    syncBuiltinESMExports();
  });
}

export function mockJwks(value: unknown): void { body = Buffer.from(JSON.stringify(value)); }
export function networkCalls() {
  return { dns: vi.mocked(dns.Resolver).mock.calls.length, tls: vi.mocked(https.request).mock.calls.length };
}
