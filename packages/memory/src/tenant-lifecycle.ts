/**
 * دورة حياة المستأجر — العقد المشترك والتنفيذ الداخلي.
 *
 * العقد طرفان: عمليات الجانب الدلالي (قبر المستأجر، الحجز القانوني، مسح
 * البيانات التشغيلية، مسح الحزم المنتهية) وعمليات الجانب الأمني (تعطيل
 * الوصول، حذف الاعتمادات، مسح الجلسات ومعاملات الدخول المنتهية).
 * المحول الحي فوق Prisma في packages/infra يحقق نفس العقود بمعاملات
 * RLS ذرية؛ ما هنا تنفيذ داخل الذاكرة للتطوير والاختبارات.
 *
 * ضوابط ثابتة لا يخالفها أي تنفيذ:
 * - الإبطالات العامة وسجل التدقيق لا تُمس إطلاقاً (تحقق الشهادات المنشورة).
 * - المسح محصور بالمستأجر معلمةً أولى فلا حذف عابر للمستأجرين بنيوياً.
 * - الحجز القانوني النافذ يمنع القبر والمسح (يُفحص في الخدمة قبل التنفيذ).
 */

import type { AuditTrailEntry } from "@agentbridge/shared";
import type {
  ArtifactRecord, CertificateRecord, CertificateRevocationRecord,
  PipelineRecord, ProjectRecord, SpecRecord, TenantRecord,
} from "./semantic-store.js";
import type {
  ApiCredentialRecord, ExternalIdentityRecord, LoginTransactionRecord, SessionRecord,
} from "./auth-contracts.js";

/** ظفر اسم المستأجر بعد الحذف — لا PII تعريفية تبقى في القبر */
export const TOMBSTONE_NAME = "deleted-tenant";
/** ظفر hash الlegacy في القبر — قيمة لا تصادق أي مفتاح حقيقي أبداً */
export const TOMBSTONE_HASH = "deleted:tombstone:no-credential";

/** أثر الحذف المتوقع — أرقام لكل مجموعة تُعرض في dry-run وتُوثق في الوصل */
export interface TenantDeletionImpact {
  readonly projects: number;
  readonly specs: number;
  readonly pipelines: number;
  readonly certificates: number;
  readonly artifacts: number;
  /** الإبطالات العامة الباقية عمداً — تحقق /verify لا ينكسر */
  readonly revocationsKept: number;
  /** صفوف التدقيق الباقية عمداً — سلسلة الهاش إلحاق فقط */
  readonly auditKept: number;
  readonly credentialsRevoked: number;
  readonly sessionsRevoked: number;
  /**
   * الهويات الخارجية اليتيمة المحذوفة: هويات المالك التي لم تعد
   * لعضوية في أي مستأجر آخر بعد حذف عضويات هذا المستأجر — الهوية
   * المشتركة مع مستأجر حي تبقى عمداً.
   */
  readonly externalIdentitiesDeleted?: number;
}

/** نتيجة مسح احتفاظ لمجموعة واحدة — الوضع موثق بصدق لا ادعاء إنفاذ */
export interface SweepClassResult {
  readonly dataClass: string;
  readonly mode: "swept" | "ttl-at-write" | "declared" | "permanent" | "tenant-lifetime" | "ephemeral";
  readonly removed: number;
}

/** عمليات دورة الحياة على الجانب الدلالي — فوق مجموعات SemanticCollections */
export interface SemanticTenantLifecycle {
  /** عدد مستأجري المسؤول الحاليين — حارس bootstrap الأول الواحد */
  countAdminTenants(): Promise<number>;
  /** حالة دورة الحياة: قبر وحجز قانوني إن وجدا */
  getTenantLifecycleState(tenantId: string): Promise<Pick<TenantRecord, "deletedAt" | "legalHoldUntil"> | null>;
  /** ضبط أو رفع الحجز القانوني — null يرفعه */
  setTenantLegalHold(tenantId: string, untilIso: string | null): Promise<void>;
  /**
   * نصب القبر — يمنع أي وصول لاحق ويبقي الصف مرساة التدقيق. القبر
   * مُقلَّل البيانات: الاسم يُستبدل بظفر اسم مستعار والهاش
   * الlegacy يُستبدل بظفر لا يصادق أي مفتاح — لا PII ولا hash اعتماد
   * غير لازم بعد الموت.
   */
  tombstoneTenant(tenantId: string, deletedAtIso: string): Promise<void>;
  /** أرقام الأثر المتوقع — قراءة خالصة لا تغيير */
  countSemanticImpact(tenantId: string): Promise<Pick<TenantDeletionImpact, "projects" | "specs" | "pipelines" | "certificates" | "artifacts" | "revocationsKept" | "auditKept">>;
  /** مسح البيانات التشغيلية حصراً — الإبطالات والتدقيق محفوظان بنيوياً */
  purgeSemanticData(tenantId: string): Promise<Pick<TenantDeletionImpact, "projects" | "specs" | "pipelines" | "certificates" | "artifacts">>;
  /** أرقام التحقق للإبطالات الباقية — تُوثق في وصل الحذف */
  listRevocationVerificationIds(tenantId: string): Promise<readonly string[]>;
  /** مسح حزم المستأجر المنتهية قبل cutoff — يعيد المحذوف */
  purgeExpiredArtifacts(tenantId: string, cutoffIso: string): Promise<number>;
}

/** عمليات L3/L4 — يحققها المحول الحي؛ الداخلي يرفضها صراحة (لا سطح مسح) */
export interface LayerSweepOps {
  purgeExpiredVectorEmbeddings(tenantId: string, cutoffIso: string): Promise<number>;
  purgeExpiredFlywheelLessons(tenantId: string, cutoffIso: string): Promise<number>;
}

/** عمليات دورة الحياة على الجانب الأمني — فوق مجموعات مخزن الهوية */
export interface AuthTenantLifecycle {
  countAuthImpact(tenantId: string): Promise<Pick<TenantDeletionImpact, "credentialsRevoked" | "sessionsRevoked">>;
  /** تعطيل الوصول فوراً: إلغاء كل اعتمادات وجلسات المستأجر */
  revokeTenantAuth(tenantId: string, atIso: string): Promise<Pick<TenantDeletionImpact, "credentialsRevoked" | "sessionsRevoked">>;
  /** حذف اعتمادات المستأجر بعد إلغائها — خطوة ما بعد القبر */
  deleteTenantCredentials(tenantId: string): Promise<number>;
  /**
   * مسح بيانات الجانب الأمني للتشغيل (توازي المسح الدلالي):
   * جلسات ومعاملات دخول وإعداد SSO للمستأجر. العضويات تُحذف داخل
   * deleteOrphanExternalIdentities لأنها مرشّح اكتشاف اليتيم.
   */
  purgeTenantAuthData(tenantId: string): Promise<{ sessions: number; loginTransactions: number }>;
  /**
   * حذف عضويات المستأجر ثم هوياته اليتيمة: هوية كانت عضواً هنا
   * فقط — بعد إزالة عضويتها تبقى بلا أي مرجع فعلي فتحذف. الهوية
   * المشتركة مع مستأجر آخر (عضوية أو جلسة باقية) تبقى عمداً.
   */
  deleteOrphanExternalIdentities(tenantId: string): Promise<number>;
  /** مسح جلسات المستأجر المنتهية absolute قبل cutoff */
  purgeExpiredSessions(tenantId: string, cutoffIso: string): Promise<number>;
  /** مسح معاملات دخول المستأجر المنتهية أو المستهلكة المنتهية قبل cutoff */
  purgeExpiredLoginTransactions(tenantId: string, cutoffIso: string): Promise<number>;
}

/** العقد الكامل — الحي يحققه كله، والداخلي يغذي L3/L4 برفض صريح */
export type TenantLifecycleStore = SemanticTenantLifecycle & AuthTenantLifecycle & LayerSweepOps;

/**
 * تنفيذ الجانب الدلالي فوق مجموعات المخزن الداخلي. الحذف بمقاربة
 * "اجمع ثم أمسح": تجميع المفاتيح المتأثرة أولاً ثم حذفها — فلا حذف
 * نصف منتهي لصفوف استُبعدت أثناء التجميع.
 */
export function semanticLifecycleOver(c: {
  tenants: Map<string, TenantRecord>;
  projects: Map<string, ProjectRecord>;
  specs: Map<string, SpecRecord>;
  pipelines: Map<string, PipelineRecord>;
  certificates: Map<string, CertificateRecord>;
  certificatesByVerificationId: Map<string, CertificateRecord>;
  revocationsByVerificationId: Map<string, CertificateRevocationRecord>;
  artifacts: Map<string, ArtifactRecord>;
  auditByTenant: Map<string, AuditTrailEntry[]>;
}): SemanticTenantLifecycle {
  const collect = function* <V>(map: Map<string, V>, tenantId: string): Generator<[string, V]> {
    for (const [key, value] of map) {
      if ((value as { tenantId: string }).tenantId === tenantId) yield [key, value];
    }
  };

  return {
    async countAdminTenants() {
      let count = 0;
      for (const tenant of c.tenants.values()) if (tenant.isAdmin === true) count += 1;
      return count;
    },

    async getTenantLifecycleState(tenantId) {
      const tenant = c.tenants.get(tenantId);
      if (tenant === undefined) return null;
      return { ...(tenant.deletedAt !== undefined ? { deletedAt: tenant.deletedAt } : {}), ...(tenant.legalHoldUntil !== undefined ? { legalHoldUntil: tenant.legalHoldUntil } : {}) };
    },

    async setTenantLegalHold(tenantId, untilIso) {
      const tenant = c.tenants.get(tenantId);
      if (tenant === undefined) throw new Error(`لا يمكن ضبط حجز قانوني لمستأجر غير موجود: ${tenantId}`);
      c.tenants.set(tenantId, untilIso === null ? { tenantId: tenant.tenantId, name: tenant.name, apiKeyHash: tenant.apiKeyHash, ...(tenant.isAdmin !== undefined ? { isAdmin: tenant.isAdmin } : {}), createdAt: tenant.createdAt, ...(tenant.deletedAt !== undefined ? { deletedAt: tenant.deletedAt } : {}) } : { ...tenant, legalHoldUntil: untilIso });
    },

    async tombstoneTenant(tenantId, deletedAtIso) {
      const tenant = c.tenants.get(tenantId);
      if (tenant === undefined) throw new Error(`لا قبلة لمستأجر غير موجود: ${tenantId}`);
      if (tenant.deletedAt !== undefined) throw new Error(`لا قبر ثانياً لمستأجر مُدقّر سابقاً (${tenant.deletedAt}): ${tenantId}`);
      // قبر مُقلَّل البيانات: الاسم بيانات تعريفية قد تكشف العميل
      // فتُستبدل بظفر، والهاش الlegacy يُستبدل بظفر لا يصادق أي مفتاح
      c.tenants.set(tenantId, { ...tenant, name: TOMBSTONE_NAME, apiKeyHash: TOMBSTONE_HASH, deletedAt: deletedAtIso });
    },

    async countSemanticImpact(tenantId) {
      const count = (map: Map<string, { tenantId: string }>) => [...map.values()].filter((v) => v.tenantId === tenantId).length;
      return {
        projects: count(c.projects),
        specs: count(c.specs),
        pipelines: count(c.pipelines),
        certificates: count(c.certificates),
        artifacts: count(c.artifacts),
        revocationsKept: [...c.revocationsByVerificationId.values()].filter((v) => v.tenantId === tenantId).length,
        auditKept: (c.auditByTenant.get(tenantId) ?? []).length,
      };
    },

    async purgeSemanticData(tenantId) {
      const remove = (map: Map<string, { tenantId: string }>) => {
        const keys = [...collect(map, tenantId)].map(([key]) => key);
        for (const key of keys) map.delete(key);
        return keys.length;
      };
      const projects = remove(c.projects);
      const specs = remove(c.specs);
      const pipelines = remove(c.pipelines);
      // الشهادات مع فهارسها برقم التحقق؛ الإبطالات في فهرس مستقل لا يُمس
      let certificates = 0;
      for (const [key, cert] of collect(c.certificates, tenantId)) {
        if (c.certificatesByVerificationId.get(cert.verificationId)?.tenantId === tenantId) {
          c.certificatesByVerificationId.delete(cert.verificationId);
        }
        c.certificates.delete(key);
        certificates += 1;
      }
      const artifacts = remove(c.artifacts);
      return { projects, specs, pipelines, certificates, artifacts };
    },

    async listRevocationVerificationIds(tenantId) {
      return [...c.revocationsByVerificationId.values()].filter((v) => v.tenantId === tenantId).map((v) => v.verificationId);
    },

    async purgeExpiredArtifacts(tenantId, cutoffIso) {
      const cutoff = Date.parse(cutoffIso);
      let removed = 0;
      for (const [key, artifact] of [...c.artifacts]) {
        if (artifact.tenantId === tenantId && Date.parse(artifact.createdAt) < cutoff) {
          c.artifacts.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

/**
 * تنفيذ الجانب الأمني فوق مجموعات مخزن الهوية الداخلي. تعطيل الوصول
 * إلغاء وليس حذفاً — فأي محاولة بين التعطيل والقبر تفشل fail-closed.
 */
export function authLifecycleOver(c: {
  identities: Map<string, ExternalIdentityRecord>;
  memberships: Map<string, MembershipRecordLike>;
  credentials: Map<string, ApiCredentialRecord>;
  sessions: Map<string, SessionRecord>;
  transactions: Map<string, LoginTransactionRecord>;
}): AuthTenantLifecycle {
  return {
    async countAuthImpact(tenantId) {
      let sessions = 0;
      for (const session of c.sessions.values()) if (session.tenantId === tenantId && session.revokedAt === undefined) sessions += 1;
      let credentials = 0;
      for (const credential of c.credentials.values()) if (credential.tenantId === tenantId && credential.revokedAt === undefined) credentials += 1;
      return { credentialsRevoked: credentials, sessionsRevoked: sessions };
    },

    async revokeTenantAuth(tenantId, atIso) {
      const counts = { credentialsRevoked: 0, sessionsRevoked: 0 };
      for (const [id, credential] of [...c.credentials]) {
        if (credential.tenantId === tenantId && credential.revokedAt === undefined) {
          c.credentials.set(id, { ...credential, revokedAt: atIso });
          counts.credentialsRevoked += 1;
        }
      }
      for (const [id, session] of [...c.sessions]) {
        if (session.tenantId === tenantId && session.revokedAt === undefined) {
          c.sessions.set(id, { ...session, revokedAt: atIso });
          counts.sessionsRevoked += 1;
        }
      }
      return counts;
    },

    async deleteTenantCredentials(tenantId) {
      let removed = 0;
      for (const [id, credential] of [...c.credentials]) {
        if (credential.tenantId === tenantId) {
          c.credentials.delete(id);
          removed += 1;
        }
      }
      return removed;
    },

    async purgeTenantAuthData(tenantId) {
      // الجانب الأمني للتشغيل يموت بموت المستأجر: جلسات ومعاملات دخول —
      // العضويات تُحذف في deleteOrphanExternalIdentities (مرشّح الاكتشاف)
      let sessions = 0;
      for (const [id, session] of [...c.sessions]) {
        if (session.tenantId === tenantId) {
          c.sessions.delete(id);
          sessions += 1;
        }
      }
      let loginTransactions = 0;
      for (const [id, transaction] of [...c.transactions]) {
        if (transaction.tenantId === tenantId) {
          c.transactions.delete(id);
          loginTransactions += 1;
        }
      }
      return { sessions, loginTransactions };
    },

    async deleteOrphanExternalIdentities(tenantId) {
      // التقاط المرشّحين قبل حذف عضوياتهم — ثم من لا مرجع فعلي له يُحذف؛
      // الهوية المشتركة مع مستأجر حي تبقى عمداً
      const candidateIds = new Set<string>();
      for (const membership of c.memberships.values()) {
        if (membership.tenantId === tenantId) candidateIds.add(membership.identityId);
      }
      for (const [id, membership] of [...c.memberships]) {
        if (membership.tenantId === tenantId) c.memberships.delete(id);
      }
      let removed = 0;
      for (const [key, identity] of [...c.identities]) {
        if (!candidateIds.has(identity.identityId)) continue;
        const hasMembershipElsewhere = [...c.memberships.values()].some((m) => m.identityId === identity.identityId);
        const hasSessionElsewhere = [...c.sessions.values()].some((s) => s.identityId === identity.identityId);
        if (!hasMembershipElsewhere && !hasSessionElsewhere) {
          c.identities.delete(key);
          removed += 1;
        }
      }
      return removed;
    },

    async purgeExpiredSessions(tenantId, cutoffIso) {
      const cutoff = Date.parse(cutoffIso);
      let removed = 0;
      for (const [id, session] of [...c.sessions]) {
        if (session.tenantId === tenantId && Date.parse(session.absoluteExpiresAt) < cutoff) {
          c.sessions.delete(id);
          removed += 1;
        }
      }
      return removed;
    },

    async purgeExpiredLoginTransactions(tenantId, cutoffIso) {
      // حدود الاحتفاظ تحترم العقد — يُمسح المنتهي قبل cutoff
      // أو المستهلك قبل cutoff؛ المستهلك الحديث يبقى حتى تقادمه
      const cutoff = Date.parse(cutoffIso);
      let removed = 0;
      for (const [id, transaction] of [...c.transactions]) {
        const expiredOld = Date.parse(transaction.expiresAt) < cutoff;
        const consumedOld = transaction.consumedAt !== undefined && Date.parse(transaction.consumedAt) < cutoff;
        if (transaction.tenantId === tenantId && (expiredOld || consumedOld)) {
          c.transactions.delete(id);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

/** صورة العضوية الداخلية المحلية — تطابق حقول MembershipRecord المستهلكة */
type MembershipRecordLike = {
  readonly membershipId: string;
  readonly identityId: string;
  readonly tenantId: string;
};
