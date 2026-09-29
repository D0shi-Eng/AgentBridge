/**
 * تحقق مفاتيح البرامج — يعيد Service Principal فقط ولا ينشئ مستخدمًا.
 * الصيغة legacy tenant:secret جسر مقيد؛ لا fallback عند فشلها.
 */
import type { AuthStore, SemanticStore } from "@agentbridge/memory";
import type { Permission, Principal } from "@agentbridge/shared";
// التحقق غير الحاجب — scrypt عبر Promise فلا يحجز حلقة الأحداث
import { verifyApiKeyAsync } from "@agentbridge/infra";

function splitCredential(raw: string): { lookup: "id" | "legacy"; id: string; secret: string } | null {
  const colon = raw.indexOf(":");
  const dot = raw.indexOf(".");
  const separator = colon > 0 ? colon : dot;
  if (separator <= 0 || separator === raw.length - 1) return null;
  return { lookup: colon > 0 ? "legacy" : "id", id: raw.slice(0, separator), secret: raw.slice(separator + 1) };
}

const LEGACY_PERMISSIONS: readonly Permission[] = ["resource:read", "pipeline:run", "pipeline:review", "artifact:read", "flywheel:read", "flywheel:write", "analytics:read"];

export async function authenticateApiKey(store: AuthStore, header: string, legacy?: SemanticStore, now: Date = new Date()): Promise<Principal | null> {
  if (!header.startsWith("Bearer ")) return null;
  const parsed = splitCredential(header.slice(7).trim());
  if (parsed === null) return null;
  let credential = parsed.lookup === "legacy"
    ? await store.findLegacyCredential(parsed.id)
    : await store.findApiCredential(parsed.id);
  // ترحيل lazy مقيد لسجل Tenant التاريخي؛ لا يُستخدم إن وُجد اعتماد جديد ولو ملغى.
  if (credential === null && parsed.lookup === "legacy" && legacy !== undefined) {
    const tenant = await legacy.getTenant(parsed.id);
    if (tenant !== null && (await verifyApiKeyAsync(parsed.secret, tenant.apiKeyHash))) {
      credential = { credentialId: `legacy:${tenant.tenantId}`, tenantId: tenant.tenantId, subjectId: `service:${tenant.tenantId}`, keyHash: tenant.apiKeyHash, permissions: LEGACY_PERMISSIONS, authorizationVersion: 1 };
      await store.putApiCredential(credential);
    }
  }
  // الفشل المغلق: ملغى أو منقضي الصلاحية = رفض بلا استثناء ولا تمديد
  const expired = credential?.expiresAt !== undefined && Date.parse(credential.expiresAt) <= now.getTime();
  if (credential === null || credential.revokedAt !== undefined || expired || !(await verifyApiKeyAsync(parsed.secret, credential.keyHash))) return null;
  return {
    actorType: "service", authMethod: "api_key", subjectId: credential.subjectId,
    credentialId: credential.credentialId, tenantId: credential.tenantId,
    permissions: [...credential.permissions], authorizationVersion: credential.authorizationVersion,
  };
}
