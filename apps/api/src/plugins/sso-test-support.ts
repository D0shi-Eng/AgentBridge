/** منصة اختبار SSO دون auth الأولي؛ القناة الشبكية اصطناعية والسياسة والتوقيع فعليان. */
import { beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyRequest } from "fastify";
import { generateKeyPairSync } from "node:crypto";
import { createInMemorySsoStore } from "@agentbridge/infra";
import { registerSsoPlugin } from "./sso.plugin.js";
import { registerErrorHandler } from "./error-handler.plugin.js";
import { setupJwksNetwork } from "./sso-test-network.js";

export function setupSsoTest() {
  setupJwksNetwork();
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keys = { publicKey: pair.publicKey.export({ format: "jwk" }), privateKey: pair.privateKey.export({ format: "jwk" }) };
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    const store = createInMemorySsoStore();
    await store.create({ tenantId: "tenant-1", provider: "oidc", issuer: "https://issuer.example.com",
      clientId: "client-123", jwksUrl: "https://issuer.example.com/keys", enabled: true });
    app = Fastify();
    registerErrorHandler(app);
    registerSsoPlugin(app, store);
    app.get("/test-sso", async (request: FastifyRequest) => ({ ssoUser: request.ssoUser ?? null }));
  });
  afterEach(async () => { await app.close(); });
  return { get app() { return app; }, keys };
}
