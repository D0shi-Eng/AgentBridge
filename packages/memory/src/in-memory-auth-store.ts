/**
 * محول الهوية داخل الذاكرة — للاختبارات والتطوير فقط.
 * الاستهلاك والتدوير عمليات متزامنة ذرية داخل عملية Node الواحدة.
 */
import type {
  ApiCredentialRecord, AuthStore, ExternalIdentityRecord, LoginTransactionRecord,
  MembershipRecord, SessionRecord,
} from "./auth-contracts.js";
import { authLifecycleOver, type AuthTenantLifecycle } from "./tenant-lifecycle.js";

/**
 * FC — مجموعات الهوية الداخلية مكشوفة كنوع لمحول دورة الحياة؛ لا يستهلكها
 * مسار إنتاج خارج هذا المحول.
 */
export interface AuthCollections {
  readonly identities: Map<string, ExternalIdentityRecord>;
  readonly memberships: Map<string, MembershipRecord>;
  readonly credentials: Map<string, ApiCredentialRecord>;
  readonly sessions: Map<string, SessionRecord>;
  readonly transactions: Map<string, LoginTransactionRecord>;
}

export function createAuthCollections(): AuthCollections {
  return { identities: new Map(), memberships: new Map(), credentials: new Map(), sessions: new Map(), transactions: new Map() };
}

/** محول الهوية الداخلي مع عمليات دورة الحياة الأمنية */
export type InMemoryAuthStore = AuthStore & AuthTenantLifecycle & InMemoryIdentityOps;

/** عمليات حذف داخلية حصراً — التراجع الدقيق عن onboarding الذري */
export interface InMemoryIdentityOps {
  deleteExternalIdentityById(identityId: string): Promise<void>;
  deleteMembership(membershipId: string): Promise<void>;
  deleteApiCredential(credentialId: string): Promise<void>;
}

export function createInMemoryAuthStore(collections: AuthCollections = createAuthCollections()): InMemoryAuthStore {
  const { identities, memberships, credentials, sessions, transactions } = collections;

  return {
    ...authLifecycleOver(collections),

    async putExternalIdentity(record) { identities.set(`${record.issuer}\u0000${record.subject}`, record); },
    async findExternalIdentity(issuer, subject) { return identities.get(`${issuer}\u0000${subject}`) ?? null; },
    // حذف الهوية بمعرفها — لتراجع onboarding الذري الداخلي؛
    // لا يلمس إلا السجل المطابق للمعرف فلا باب حذف عريض
    async deleteExternalIdentityById(identityId) {
      for (const [key, record] of identities) if (record.identityId === identityId) identities.delete(key);
    },
    async putMembership(record) { memberships.set(record.membershipId, record); },
    async deleteMembership(membershipId) { memberships.delete(membershipId); },
    async getMembership(membershipId, tenantId) {
      const found = memberships.get(membershipId);
      return found?.tenantId === tenantId ? found : null;
    },
    async findMembership(identityId, tenantId) {
      return [...memberships.values()].find((item) => item.identityId === identityId && item.tenantId === tenantId) ?? null;
    },
    async putApiCredential(record) {
      credentials.set(record.credentialId, record);
      // إلغاء الاعتماد يُسقط عضويته الداخلية وجلساته المشتقة ذرياً
      if (record.revokedAt !== undefined) {
        const memberId = `internal-member:${record.credentialId}`;
        const membership = memberships.get(memberId);
        if (membership !== undefined && membership.status === "active") {
          memberships.set(memberId, { ...membership, status: "disabled" });
        }
        for (const [id, session] of sessions) {
          if (session.membershipId === memberId && session.revokedAt === undefined) {
            sessions.set(id, { ...session, revokedAt: record.revokedAt });
          }
        }
      }
    },
    async findApiCredential(credentialId) { return credentials.get(credentialId) ?? null; },
    // حذف الاعتماد بمعرفه — لتراجع onboarding الذري الداخلي
    async deleteApiCredential(credentialId) { credentials.delete(credentialId); },
    async findLegacyCredential(tenantId) {
      return [...credentials.values()].find((item) => item.tenantId === tenantId && item.credentialId === `legacy:${tenantId}`) ?? null;
    },
    async putSession(record) { sessions.set(record.sessionId, record); },
    async findSessionByHash(tokenHash) {
      return [...sessions.values()].find((item) => item.tokenHash === tokenHash) ?? null;
    },
    async revokeSession(sessionId, tenantId, revokedAt) {
      const current = sessions.get(sessionId);
      if (current === undefined || current.tenantId !== tenantId || current.revokedAt !== undefined) return false;
      sessions.set(sessionId, { ...current, revokedAt });
      return true;
    },
    async rotateSession(expectedId, next) {
      const current = sessions.get(expectedId);
      if (current === undefined || current.revokedAt !== undefined) return false;
      sessions.set(expectedId, { ...current, revokedAt: new Date().toISOString() });
      sessions.set(next.sessionId, next);
      return true;
    },
    async putLoginTransaction(record) { transactions.set(record.transactionId, record); },
    async consumeLoginTransaction(stateHash, consumedAt) {
      const found = [...transactions.values()].find((item) => item.stateHash === stateHash);
      if (found === undefined || found.consumedAt !== undefined) return null;
      const consumed = { ...found, consumedAt };
      transactions.set(found.transactionId, consumed);
      return found;
    },
  };
}
