/**
 * دورة حياة المستأجر الحية فوق PostgreSQL/Prisma —
 * نفس عقود المحول الداخلي بمعاملات RLS ذرية لكل عملية. المسح التشغيلي
 * معاملة واحدة بترتيب FKs تنازلياً (حزم/شهادات قبل pipelines، pipelines
 * قبل specs، sessions قبل memberships) فلا نصف مسح؛ الإبطالات العامة
 * (certificate_revocations) وسجل التدقيق خارج المسح حصراً — بنيوياً
 * لا بالتجاهل. هويات المالك اليتيمة تُحذف بعد العضويات، والقبر
 * مُقلَّل البيانات (بلا اسم وبلا hash اعتماد). خطوات الخدمة كلها
 * إيدبوتنتية فالاستئناف من أي مرحلة آمن (سياج السجل).
 */

import type { PrismaClient } from "@prisma/client";
import type { TenantLifecycleStore } from "@agentbridge/memory";
import { TOMBSTONE_HASH, TOMBSTONE_NAME } from "@agentbridge/memory";
import { withLookupPrisma, withTenantPrisma } from "./prisma-scope.js";

export function createPrismaTenantLifecycle(client: PrismaClient): TenantLifecycleStore {
  return {
    async countAdminTenants() {
      // دور ab_app يرى مستأجره وحده (FORCE RLS) — العد العابر للمستأجرين
      // مرفوض هنا عمداً؛ حارس bootstrap الحي في prisma-tenant-onboarding
      // عبر اتصال المشغّل حصراً
      throw new Error("countAdminTenants الحي يتطلب اتصال مشغّل — استخدم assertBootstrapAvailable في prisma-tenant-onboarding");
    },

    async getTenantLifecycleState(tenantId) {
      return withTenantPrisma(client, tenantId, async (tx) => {
        const row = await tx.tenant.findUnique({ where: { id: tenantId } });
        if (row === null) return null;
        return {
          ...(row.deleted_at === null ? {} : { deletedAt: row.deleted_at.toISOString() }),
          ...(row.legal_hold_until === null ? {} : { legalHoldUntil: row.legal_hold_until.toISOString() }),
        };
      });
    },

    async setTenantLegalHold(tenantId, untilIso) {
      await withTenantPrisma(client, tenantId, async (tx) => {
        const updated = await tx.tenant.updateMany({
          where: { id: tenantId, deleted_at: null },
          data: { legal_hold_until: untilIso === null ? null : new Date(untilIso) },
        });
        if (updated.count === 0) throw new Error(`لا حجز قانوني لمستأجر غير موجود أو مُدقّر: ${tenantId}`);
      });
    },

    async tombstoneTenant(tenantId, deletedAtIso) {
      await withTenantPrisma(client, tenantId, async (tx) => {
        // قبر مُقلَّل البيانات: deleted_at يمنع الإحياء، والاسم
        // يُستبدل بظفر لا يحمل PII، والهاش الlegacy يُستبدل بظفر لا
        // يصادق أي مفتاح — لا بيانات تعريفية ولا hash اعتماد غير لازم
        const updated = await tx.tenant.updateMany({
          where: { id: tenantId, deleted_at: null },
          data: { deleted_at: new Date(deletedAtIso), name: TOMBSTONE_NAME, api_key_hash: TOMBSTONE_HASH },
        });
        if (updated.count === 0) throw new Error(`لا قبر لمستأجر غير موجود أو مُدقّر سابقاً: ${tenantId}`);
      });
    },

    async countSemanticImpact(tenantId) {
      return withTenantPrisma(client, tenantId, async (tx) => {
        const [projects, specs, pipelines, certificates, artifacts, revocations, audit] = await Promise.all([
          tx.project.count({ where: { tenant_id: tenantId } }),
          tx.spec.count({ where: { tenant_id: tenantId } }),
          tx.pipeline.count({ where: { tenant_id: tenantId } }),
          tx.certificate.count({ where: { tenant_id: tenantId } }),
          tx.artifact.count({ where: { tenant_id: tenantId } }),
          tx.certificateRevocation.count({ where: { tenant_id: tenantId } }),
          tx.auditLog.count({ where: { tenant_id: tenantId } }),
        ]);
        return { projects, specs, pipelines, certificates, artifacts, revocationsKept: revocations, auditKept: audit };
      });
    },

    async countAuthImpact(tenantId) {
      return withTenantPrisma(client, tenantId, async (tx) => {
        const [credentials, sessions] = await Promise.all([
          tx.apiCredential.count({ where: { tenant_id: tenantId, revoked_at: null } }),
          tx.session.count({ where: { tenant_id: tenantId, revoked_at: null } }),
        ]);
        return { credentialsRevoked: credentials, sessionsRevoked: sessions };
      });
    },

    async revokeTenantAuth(tenantId, atIso) {
      return withTenantPrisma(client, tenantId, async (tx) => {
        const credentials = await tx.apiCredential.updateMany({ where: { tenant_id: tenantId, revoked_at: null }, data: { revoked_at: new Date(atIso) } });
        const sessions = await tx.session.updateMany({ where: { tenant_id: tenantId, revoked_at: null }, data: { revoked_at: new Date(atIso) } });
        return { credentialsRevoked: credentials.count, sessionsRevoked: sessions.count };
      });
    },

    async deleteTenantCredentials(tenantId) {
      return withTenantPrisma(client, tenantId, async (tx) =>
        (await tx.apiCredential.deleteMany({ where: { tenant_id: tenantId } })).count);
    },

    async deleteOrphanExternalIdentities(tenantId) {
      // التقاط هويات المستأجر من عضوياتها وحذف العضويات أولاً —
      // ثم محاولة حذف كل هوية مرشّحة في معاملة مستقلة كي لا يُفسد تعارض
      // FK لمرشّح واحد بقيَ المرشّحين الآخرين. العضويات في مستأجر آخر
      // غير مرئية تحت RLS عمداً — قيد FK هو الحكم الأمين: P2003 =
      // الهوية مشتركة مع مستأجر حي فتبقى، واليتيمة تُحذف فعلاً. الحذف
      // كله داخل سياج الهوية (app.identity_write) نفسه.
      const candidateIds = await withTenantPrisma(client, tenantId, async (tx) => {
        const members = await tx.membership.findMany({ where: { tenant_id: tenantId }, select: { identity_id: true } });
        await tx.membership.deleteMany({ where: { tenant_id: tenantId } });
        return [...new Set(members.map((m) => m.identity_id))];
      });
      let removed = 0;
      for (const identityId of candidateIds) {
        try {
          removed += await withLookupPrisma(client, [
            ["app.tenant_id", tenantId],
            ["app.identity_write", "1"],
            // سياق الحذف الصريح: مفتاح سياسة قراءة الهويات الداخلية لسيع
            // الحذف حصراً — لا يضعه أي مسار آخر فيتسع القراءة بغيره.
            ["app.deletion_context", "1"],
          ], async (tx) => {
            const sessionCount = await tx.session.count({ where: { identity_id: identityId } });
            if (sessionCount > 0) return 0;
            return (await tx.externalIdentity.deleteMany({ where: { id: identityId } })).count;
          });
        } catch (error) {
          if ((error as { code?: string }).code !== "P2003") throw error;
        }
      }
      return removed;
    },

    async purgeSemanticData(tenantId) {
      // معاملة واحدة بترتيب FKs تنازلياً — الذرية كاملة فلا نصف مسح.
      // الجانب الأمني (جلسات/معاملات دخول/عضويات/SSO) في purgeTenantAuthData
      return withTenantPrisma(client, tenantId, async (tx) => {
        const artifacts = await tx.artifact.deleteMany({ where: { tenant_id: tenantId } });
        const certificates = await tx.certificate.deleteMany({ where: { tenant_id: tenantId } });
        // الإبطالات العامة لا يُمس أي صف منها عمداً — تحقق /verify باقٍ
        const pipelines = await tx.pipeline.deleteMany({ where: { tenant_id: tenantId } });
        const specs = await tx.spec.deleteMany({ where: { tenant_id: tenantId } });
        const projects = await tx.project.deleteMany({ where: { tenant_id: tenantId } });
        await tx.runStateArchive.deleteMany({ where: { tenant_id: tenantId } });
        await tx.memoryEmbedding.deleteMany({ where: { tenant_id: tenantId } });
        await tx.flywheelLesson.deleteMany({ where: { tenant_id: tenantId } });
        await tx.llmSpend.deleteMany({ where: { tenant_id: tenantId } });
        return { projects: projects.count, specs: specs.count, pipelines: pipelines.count, certificates: certificates.count, artifacts: artifacts.count };
      });
    },

    async purgeTenantAuthData(tenantId) {
      // الجانب الأمني للتشغيل يموت بموت المستأجر: جلسات ومعاملات دخول
      // وإعداد SSO — العضويات تُحذف في deleteOrphanExternalIdentities
      return withTenantPrisma(client, tenantId, async (tx) => {
        const sessions = await tx.session.deleteMany({ where: { tenant_id: tenantId } });
        const loginTransactions = await tx.loginTransaction.deleteMany({ where: { tenant_id: tenantId } });
        await tx.ssoConfig.deleteMany({ where: { tenant_id: tenantId } });
        return { sessions: sessions.count, loginTransactions: loginTransactions.count };
      });
    },

    async listRevocationVerificationIds(tenantId) {
      return withTenantPrisma(client, tenantId, async (tx) => {
        const rows = await tx.certificateRevocation.findMany({ where: { tenant_id: tenantId }, select: { verification_id: true } });
        return rows.map((row) => row.verification_id);
      });
    },

    async purgeExpiredArtifacts(tenantId, cutoffIso) {
      return withTenantPrisma(client, tenantId, async (tx) =>
        (await tx.artifact.deleteMany({ where: { tenant_id: tenantId, created_at: { lt: new Date(cutoffIso) } } })).count);
    },

    async purgeExpiredSessions(tenantId, cutoffIso) {
      return withTenantPrisma(client, tenantId, async (tx) =>
        (await tx.session.deleteMany({ where: { tenant_id: tenantId, absolute_expires_at: { lt: new Date(cutoffIso) } } })).count);
    },

    async purgeExpiredLoginTransactions(tenantId, cutoffIso) {
      // حدود الاحتفاظ تحترم عقد السياسة — يُمسح المنتهي قبل cutoff
      // أو المستهلك قبل cutoff؛ المستهلك الحديث يبقى حتى تقادمه
      return withTenantPrisma(client, tenantId, async (tx) =>
        (await tx.loginTransaction.deleteMany({
          where: {
            tenant_id: tenantId,
            OR: [{ expires_at: { lt: new Date(cutoffIso) } }, { consumed_at: { lt: new Date(cutoffIso) } }],
          },
        })).count);
    },

    async purgeExpiredVectorEmbeddings(tenantId, cutoffIso) {
      return withTenantPrisma(client, tenantId, async (tx) =>
        (await tx.memoryEmbedding.deleteMany({ where: { tenant_id: tenantId, created_at: { lt: new Date(cutoffIso) } } })).count);
    },

    async purgeExpiredFlywheelLessons(tenantId, cutoffIso) {
      return withTenantPrisma(client, tenantId, async (tx) =>
        (await tx.flywheelLesson.deleteMany({ where: { tenant_id: tenantId, created_at: { lt: new Date(cutoffIso) } } })).count);
    },
  };
}
