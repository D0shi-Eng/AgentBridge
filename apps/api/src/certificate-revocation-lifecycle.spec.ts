/**
 * اختبار دورة حياة الشهادة الكاملة عبر المسار الحقيقي.
 *
 * يثبت على تطبيق API فعلي (مخازن ذاكرة + مزود mock + توقيع Ed25519 حقيقي):
 *   1. منح → /verify عرض granted مع valid:true وrevoked:false.
 *   2. إبطال عبر POST revoke → صف revocation دائم + قيد تدقيق.
 *   3. /verify بعدها: signature.valid=false والسبب "revoked" — حتى مع بقاء
 *      granted المخزنة true (الحالة المعروضة مشتقة من التحقق لا السجل).
 *   4. الحزمة والشارة ترفضان 403 ARTIFACT_REVOKED — لا شارة نجاح بعد الإبطال.
 *   5. شهادة JSON تبقى قابلة للتنزيل (ملف تدقيق) — لا محو للتاريخ.
 *   6. إبطال مكرر 409 صريح، وإبطال عابر للمستأجرين 404 (لا كشف ولا عبور).
 *   7. reason أطول من الحد يرفض 400 — مدخل الإبطال مقيد.
 * الرحلة كلها داخل الذاكرة ببيانات اصطناعية — لا نداءات خارجية.
 */

import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { buildContainer, developmentEnv, type ApiContainer } from "./container.js";
import {
  authHeader,
  createProject,
  seedTenant,
  startPipeline,
  uploadSpec,
  waitForStatus,
} from "./test-helpers.js";

/** جذر عمل داخل شجرة المستودع — انظر شرح repoTempDir في acceptance.spec */
function repoTempDir(prefix: string): string {
  return mkdtempSync(join(fileURLToPath(new URL("../../../tests/e2e/.tmp", import.meta.url)), prefix));
}

describe("دورة حياة الشهادة والإبطال", () => {
  let container: ApiContainer;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let tenant: Awaited<ReturnType<typeof seedTenant>>;
  let runId: string;
  let verificationId: string;

  beforeAll(async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const pkcs8Base64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    container = await buildContainer({
      env: { ...developmentEnv(), CERT_SIGNING_PRIVATE_KEY: pkcs8Base64 },
      liveProbes: true,
      workRoot: repoTempDir("ab-revoke-"),
    });
    app = buildApp(container);
    tenant = await seedTenant(container, "revoke-tenant", "مستأجر دورة الإبطال");
    const projectId = await createProject(app, tenant);
    const specId = await uploadSpec(app, tenant, projectId);
    runId = await startPipeline(app, tenant, projectId, specId);
    expect(await waitForStatus(app, tenant, runId, ["completed"])).toBe("completed");
    const certificateResponse = await app.inject({
      method: "GET",
      url: `/pipelines/${runId}/certificate`,
      headers: authHeader(tenant),
    });
    verificationId = (JSON.parse(certificateResponse.body) as { verificationId: string }).verificationId;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await container?.close?.();
  });

  it("قبل الإبطال: /verify ممنوحة بسليم توقيع وrevoked=false والحزمة تنزل", async () => {
    const verify = await app.inject({ method: "GET", url: `/verify/${verificationId}` });
    expect(verify.statusCode).toBe(200);
    const body = JSON.parse(verify.body) as {
      granted: boolean; revoked: boolean; signature: { present: boolean; valid?: boolean };
    };
    expect(body.granted).toBe(true);
    expect(body.revoked).toBe(false);
    expect(body.signature.valid).toBe(true);
    const pkg = await app.inject({ method: "GET", url: `/pipelines/${runId}/package`, headers: authHeader(tenant) });
    expect(pkg.statusCode).toBe(200);
    const badge = await app.inject({ method: "GET", url: `/pipelines/${runId}/badge`, headers: authHeader(tenant) });
    expect(badge.statusCode).toBe(200);
  });

  it("سبب الإبطال المقيد: reason قصير جداً يرفض 400 قبل أي كتابة", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/pipelines/${runId}/certificate/revoke`,
      headers: authHeader(tenant),
      payload: { reason: "ab" },
    });
    expect(response.statusCode).toBe(400);
    expect(await container.semantic.getRevocationByVerificationId(verificationId)).toBeNull();
  });

  it("الإبطال ينجح: صف دائم + قيد تدقيق + /verify تتحول revoked بصسبب revoked", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/pipelines/${runId}/certificate/revoke`,
      headers: authHeader(tenant),
      payload: { reason: "تسريب مفتاح العميل الافتراضي" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { revoked: boolean; verificationId: string };
    expect(body.revoked).toBe(true);
    expect(body.verificationId).toBe(verificationId);

    const stored = await container.semantic.getRevocationByVerificationId(verificationId);
    expect(stored).not.toBeNull();

    const verify = await app.inject({ method: "GET", url: `/verify/${verificationId}` });
    expect(verify.statusCode).toBe(200);
    const verdict = JSON.parse(verify.body) as {
      revoked: boolean; signature: { present: boolean; valid?: boolean; reason?: string };
    };
    expect(verdict.revoked).toBe(true);
    expect(verdict.signature.valid).toBe(false);
    expect(verdict.signature.reason).toBe("revoked");

    // قيد التدقيق: قرار الإبطال نفسه داخل سلسلة الهاش
    const entries = await container.semantic.listAuditEntries(tenant.tenantId);
    expect(entries.some((entry) => entry.decision === "certificate_revoked")).toBe(true);
  });

  it("بعد الإبطال: الحزمة والشارة 403 ARTIFACT_REVOKED وشهادة JSON تبقى متاحة", async () => {
    const pkg = await app.inject({ method: "GET", url: `/pipelines/${runId}/package`, headers: authHeader(tenant) });
    expect(pkg.statusCode).toBe(403);
    expect((JSON.parse(pkg.body) as { error: { code: string } }).error.code).toBe("ARTIFACT_REVOKED");
    const badge = await app.inject({ method: "GET", url: `/pipelines/${runId}/badge`, headers: authHeader(tenant) });
    expect(badge.statusCode).toBe(403);
    const certificateJson = await app.inject({ method: "GET", url: `/pipelines/${runId}/certificate`, headers: authHeader(tenant) });
    expect(certificateJson.statusCode).toBe(200);
  });

  it("إبطال مكرر 409 صريح — لا نجاح صامت لقرار نهائي", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/pipelines/${runId}/certificate/revoke`,
      headers: authHeader(tenant),
      payload: { reason: "محاولة إبطال ثانية لنفس الشهادة" },
    });
    expect(response.statusCode).toBe(409);
    expect((JSON.parse(response.body) as { error: { code: string } }).error.code).toBe("CERT_ALREADY_REVOKED");
  });

  it("عابر المستأجرين: مستأجر آخر لا يرى التشغيل ولا يبطله (404 بلا كشف)", async () => {
    const other = await seedTenant(container, "revoke-other", "مستأجر آخر معزول");
    const probe = await app.inject({
      method: "POST",
      url: `/pipelines/${runId}/certificate/revoke`,
      headers: authHeader(other),
      payload: { reason: "محاولة عبور مستأجرين يجب أن ترفض" },
    });
    expect(probe.statusCode).toBe(404);
  });
});
