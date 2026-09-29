/** اختبارات canary لمغلف AEAD وحدود AAD وتدوير keyId. */
import { describe, expect, it } from "vitest";
import { createStaticKeyProvider, openSecret, sealSecret } from "./secret-envelope.js";

const key = Buffer.alloc(32, 7);
const provider = createStaticKeyProvider(key, "test-v1");
const context = { tenantId: "tenant-a", resourceId: "sso-config", purpose: "oidc_client_secret" as const, version: 1 };

describe("مغلف الأسرار", () => {
  it("يسترجع canary ولا يظهر plaintext ويستخدم IV جديداً", () => {
    const canary = "phase3-secret-canary";
    const first = sealSecret(provider, canary, context);
    const second = sealSecret(provider, canary, context);
    expect(first).not.toContain(canary);
    expect(second).not.toBe(first);
    expect(openSecret(provider, first, context)).toMatchObject({ ok: true, value: canary });
  });

  it.each([
    { ...context, tenantId: "tenant-b" },
    { ...context, resourceId: "other" },
    { ...context, purpose: "pkce_verifier" as const },
    { ...context, version: 2 },
  ])("يرفض نقل ciphertext إلى سياق آخر", (wrong) => {
    const result = openSecret(provider, sealSecret(provider, "canary", context), wrong);
    expect(result.ok).toBe(false);
  });

  it("يرفض العبث والمفتاح الخطأ والإصدار غير المدعوم", () => {
    const envelope = sealSecret(provider, "canary", context);
    // عبث بآخر حرف مع تحويله حتماً لقيمة مختلفة عن الأصل — آخر حرف 'A'
    // (أو أي حرف) يُستبدل بذيل ثابت مختلف فلا تمر العبثية الصفرية
    const tamperedLast = `${envelope.slice(0, -1)}${envelope.endsWith("A") ? "B" : "A"}`;
    expect(openSecret(provider, tamperedLast, context).ok).toBe(false);
    expect(openSecret(createStaticKeyProvider(Buffer.alloc(32, 8), "other"), envelope, context).ok).toBe(false);
    expect(openSecret(provider, envelope.replace(/^v1:/u, "v2:"), context).ok).toBe(false);
  });
});
