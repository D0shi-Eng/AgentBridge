/** اختبارات عدم التراجع: لا توجد قناة bearer داخلية أو hint للمستأجر. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { buildContainer, developmentEnv } from "../container.js";
import { authHeader, seedTenant, type SeededTenant } from "../test-helpers.js";

describe("المصادقة المركزية", () => {
  const root = mkdtempSync(join(tmpdir(), "ab-central-auth-"));
  // async الحاوية: فحص الدور المقيد fail-closed عند الإقلاع — يُحل في beforeAll
  let container: Awaited<ReturnType<typeof buildContainer>>;
  const appHolder: { app?: ReturnType<typeof buildApp> } = {};
  let tenant: SeededTenant;
  beforeAll(async () => {
    container = await buildContainer({ env: developmentEnv(), workRoot: root });
    appHolder.app = buildApp(container);
    tenant = await seedTenant(container, "tenant-auth", "Auth");
  });
  const app = () => appHolder.app!;
  afterAll(async () => { await app().close(); rmSync(root, { recursive: true, force: true }); });

  it.each(["Basic dXNlcjpwYXNz", "Bearer ", "Bearer oidc-int:user:123", "Bearer malformed.jwt.value"])(
    "يرفض الاعتماد غير الموثوق %s", async (authorization) => {
      const response = await app().inject({ method: "GET", url: "/projects", headers: { authorization } });
      expect(response.statusCode).toBe(401);
    },
  );
  it("يقبل API key واحداً ويرفض الاعتمادات المتضاربة", async () => {
    expect((await app().inject({ method: "GET", url: "/projects", headers: authHeader(tenant) })).statusCode).toBe(200);
    const response = await app().inject({ method: "GET", url: "/projects", headers: { ...authHeader(tenant), "x-api-key": `${tenant.tenantId}:${tenant.apiKey}` } });
    expect(response.statusCode).toBe(401);
  });
});
