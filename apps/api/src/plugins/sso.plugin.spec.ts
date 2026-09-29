/** يثبت أن رموز OIDC لا تُقبل كـ bearer وأن الجلسة هي حد المستخدم. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signOidcToken } from "@agentbridge/infra";
import { buildApp } from "../app.js";
import { buildContainer, developmentEnv } from "../container.js";
import { seedTenant } from "../test-helpers.js";

describe("حد OIDC المركزي", () => {
  const workRoot = mkdtempSync(join(tmpdir(), "ab-oidc-boundary-"));
  // async الحاوية: فحص الدور المقيد fail-closed عند الإقلاع — يُحل في beforeAll
  let container: Awaited<ReturnType<typeof buildContainer>>;
  const appHolder: { app?: ReturnType<typeof buildApp> } = {};
  const app = () => appHolder.app!;

  beforeAll(async () => {
    container = await buildContainer({ env: developmentEnv(), workRoot });
    appHolder.app = buildApp(container);
    await seedTenant(container, "tenant-1", "Test");
  });
  afterAll(async () => { await app().close(); rmSync(workRoot, { recursive: true, force: true }); });

  it("يرفض id_token في Authorization", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const token = signOidcToken(
      { sub: "user1", exp: Math.floor(Date.now() / 1000) + 3600, aud: "client", iss: "https://issuer.example.com" },
      pair.privateKey.export({ format: "jwk" }) as Record<string, unknown>, "kid",
    );
    const response = await app().inject({ method: "GET", url: "/projects", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(401);
  });
});
