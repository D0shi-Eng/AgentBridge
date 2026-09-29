/**
 * اختبار عقد /verify النهائي مع توقيع حي:
 *
 * يثبت على المسار الحي: (1) شهادة موقعة فعلاً تعرض {present:true,
 * valid:true} ضمن القائمة البيضاء؛ (2) مفتاح التحقق غائب/مبطّل
 * (دوران أو إبطال) → {present:true, valid:false} مع reason آمن —
 * لا 500 ولا valid=true زائفة ولا تسريب؛ (3) لا كسر لعقد الحقول.
 * الرحلة كاملة داخل الذاكرة بمزود اصطناعي — لا نداءات خارجية.
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

describe("عقد /verify مع توقيع حي", () => {
  let container: ApiContainer;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let verificationId: string;

  beforeAll(async () => {
    // مفتاح توقيع Ed25519 مولد اختبارياً بأسلوب الإنتاج (PKCS8 base64) —
    // فيُوقّع الأنبوب الشهادة فعلاً بدل اكتفاء present:false
    const { privateKey } = generateKeyPairSync("ed25519");
    const pkcs8Base64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    container = await buildContainer({
      env: { ...developmentEnv(), CERT_SIGNING_PRIVATE_KEY: pkcs8Base64 },
      liveProbes: true,
      workRoot: repoTempDir("ab-vsig-"),
    });
    app = buildApp(container);
    const tenant = await seedTenant(container, "vsig-tenant", "مستأجر عقد التوقيع");
    const projectId = await createProject(app, tenant);
    const specId = await uploadSpec(app, tenant, projectId);
    const runId = await startPipeline(app, tenant, projectId, specId);
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

  it("شهادة موقعة فعلاً: present=true وvalid=true ضمن القائمة البيضاء بلا تسريب", async () => {
    const response = await app.inject({ method: "GET", url: `/verify/${verificationId}` });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      verificationId: string; artifactsHash: string; signature: { present: boolean; valid?: boolean; reason?: string };
    };
    expect(body.verificationId).toBe(verificationId);
    expect(typeof body.artifactsHash).toBe("string");
    expect(body.artifactsHash.length).toBeGreaterThan(0);
    expect(body.signature.present).toBe(true);
    expect(body.signature.valid).toBe(true);
    // لا تسريب لإشارات داخلية في الاستجابة الموقعة
    expect(response.body).not.toContain("vsig-tenant");
    expect(response.body).not.toContain("PRIVATE");
  });

  it("مفتاح التحقق غائب/مبطّل (دوران/إبطال): present=true وvalid=false مع reason آمن — لا 500 ولا قبول زائف", async () => {
    // نسخة الحاوية بحلقة مفاتيح فارغة تحاكي دوراناً أزال المفتاح القديم
    const rotatedView = buildApp({ ...container, certificateKeys: new Map() });
    try {
      const response = await rotatedView.inject({ method: "GET", url: `/verify/${verificationId}` });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { signature: { present: boolean; valid?: boolean; reason?: string } };
      expect(body.signature.present).toBe(true);
      expect(body.signature.valid).toBe(false);
      expect(typeof body.signature.reason).toBe("string");
      expect(body.signature.reason?.length ?? 0).toBeGreaterThan(0);
    } finally {
      await rotatedView.close();
    }
  });
});
