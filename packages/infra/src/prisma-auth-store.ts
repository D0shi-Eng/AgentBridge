/**
 * مخزن الهوية الحي — كل عملية عبر معاملة RLS واحدة:
 * عمليات المستأجر عبر withTenantPrisma ومنافذ pre-auth الضيقة عبر
 * withLookupPrisma. الأسرار hashes ومغلفات فقط، وإلغاء الاعتماد
 * يلغي العضوية والجلسات المشتقة ذرياً في المعاملة نفسها.
 */
import type { PrismaClient } from "@prisma/client";
import type { AuthStore } from "@agentbridge/memory";
import { credentialFromRow, identityFromRow, membershipFromRow, sessionFromRow, transactionFromRow } from "./auth-mappers.js";
import { withLookupPrisma, withTenantPrisma, type ScopedSetting } from "./prisma-scope.js";

/** معرف العضوية الداخلية المشتقة من اعتماد — حتمي لإلغائها لاحقاً */
export function internalMembershipId(credentialId: string): string {
  return `internal-member:${credentialId}`;
}
/** معرف الهوية الداخلية المشتقة من اعتماد */
export function internalIdentityId(credentialId: string): string {
  return `internal:${credentialId}`;
}

export function createPrismaAuthStore(client: PrismaClient): AuthStore {
  return {
    // الهويات الخارجية: كتابة إدارية عبر بوابة identity_write
    async putExternalIdentity(record) {
      const data = { issuer: record.issuer, subject: record.subject, created_at: new Date(record.createdAt) };
      // الهوية الداخلية المشتقة من اعتماد: سياسات SELECT تُشترط على مسح
      // التحديث أيضاً، وسياسة القراءة الداخلية تتطلب app.credential_id لرؤية
      // صف internal:<credential>. بدونه يرى التحديث صفر صفوف ثم يصطدم
      // الإدراج بقيد (issuer,subject) الفريد — فيفشل كل دخول ثانٍ بنفس
      // الاعتماد. ضبطه يخص الهويات الداخلية حصراً (issuer الثابت) ولا يوسع
      // رؤية أي هوية خارجية.
      const settings: Array<ScopedSetting> = [["app.identity_write", "1"]];
      if (record.issuer === "urn:agentbridge:internal") settings.push(["app.credential_id", record.subject]);
      await withLookupPrisma(client, settings, async (tx) => {
        // تحديث-ثم-إدراج: أي ON CONFLICT يستلزم مرور الصف بسياسة
        // SELECT فتفتح بوابة الكتابة قراءة أوسع؛ هنا UPDATE ببوابة identity_write
        // والإدراج الصرف بسياسة INSERT وحدها — لا توسيع للقراءة في الحالين.
        const updated = await tx.$executeRawUnsafe(
          `UPDATE "external_identities" SET "issuer"=$2, "subject"=$3, "created_at"=$4 WHERE "id"=$1`,
          record.identityId, data.issuer, data.subject, data.created_at,
        );
        if (updated === 0) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "external_identities" ("id","issuer","subject","created_at") VALUES ($1,$2,$3,$4)`,
            record.identityId, record.issuer, record.subject, data.created_at,
          );
        }
      });
    },

    async findExternalIdentity(issuer, subject) {
      const row = await withLookupPrisma(client, [["app.identity_issuer", issuer], ["app.identity_subject", subject]], (tx) =>
        tx.externalIdentity.findFirst({ where: { issuer, subject } }));
      return row === null ? null : identityFromRow(row);
    },

    // العضويات: قراءة بنطاق المستأجر وكتابة إدارية عبر identity_write
    async putMembership(record) {
      const data = { identity_id: record.identityId, tenant_id: record.tenantId, role: record.role, status: record.status, authorization_version: record.authorizationVersion };
      await withLookupPrisma(client, [["app.identity_write", "1"], ["app.tenant_id", record.tenantId]], async (tx) => {
        await tx.membership.upsert({ where: { id: record.membershipId }, create: { id: record.membershipId, ...data }, update: data });
      });
    },

    async getMembership(membershipId, tenantId) {
      const row = await withTenantPrisma(client, tenantId, (tx) => tx.membership.findFirst({ where: { id: membershipId, tenant_id: tenantId } }));
      return row === null ? null : membershipFromRow(row);
    },

    async findMembership(identityId, tenantId) {
      const row = await withTenantPrisma(client, tenantId, (tx) => tx.membership.findFirst({ where: { identity_id: identityId, tenant_id: tenantId } }));
      return row === null ? null : membershipFromRow(row);
    },

    // اعتمادات API: كتابة بنطاق المستأجر وإلغاء ذري للجلسات المشتقة
    async putApiCredential(record) {
      const data = { tenant_id: record.tenantId, subject_id: record.subjectId, key_hash: record.keyHash, permissions: [...record.permissions], authorization_version: record.authorizationVersion, revoked_at: record.revokedAt === undefined ? null : new Date(record.revokedAt), expires_at: record.expiresAt === undefined ? null : new Date(record.expiresAt) };
      await withTenantPrisma(client, record.tenantId, async (tx) => {
        await tx.apiCredential.upsert({ where: { id: record.credentialId }, create: { id: record.credentialId, ...data }, update: data });
        // إلغاء الاعتماد يُسقط عضويته الداخلية وجلساته المشتقة في المعاملة نفسها
        if (record.revokedAt !== undefined) {
          const memberId = internalMembershipId(record.credentialId);
          await tx.membership.updateMany({ where: { id: memberId, status: "active" }, data: { status: "disabled" } });
          await tx.session.updateMany({ where: { membership_id: memberId, revoked_at: null }, data: { revoked_at: new Date(record.revokedAt) } });
        }
      });
    },

    async findApiCredential(credentialId) {
      // منفذ pre-auth: البحث بالمعرف وحده — سياسة credential_exact_lookup تطابق الصف حصراً
      const row = await withLookupPrisma(client, [["app.credential_id", credentialId]], (tx) =>
        tx.apiCredential.findFirst({ where: { id: credentialId } }));
      return row === null ? null : credentialFromRow(row);
    },

    async findLegacyCredential(tenantId) {
      const row = await withTenantPrisma(client, tenantId, (tx) => tx.apiCredential.findFirst({ where: { id: `legacy:${tenantId}`, tenant_id: tenantId } }));
      return row === null ? null : credentialFromRow(row);
    },

    // الجلسات: تقييد المستأجر إلزامي في الإلغاء والتدوير
    async putSession(record) {
      await withTenantPrisma(client, record.tenantId, async (tx) => {
        await tx.session.create({ data: {
          id: record.sessionId, token_hash: record.tokenHash, csrf_hash: record.csrfHash,
          browser_binding_hash: record.browserBindingHash, identity_id: record.identityId,
          auth_method: record.authMethod, membership_id: record.membershipId, tenant_id: record.tenantId,
          permissions: [...record.permissions], authorization_version: record.authorizationVersion,
          idle_expires_at: new Date(record.idleExpiresAt), absolute_expires_at: new Date(record.absoluteExpiresAt),
          revoked_at: record.revokedAt === undefined ? null : new Date(record.revokedAt),
        } });
      });
    },

    async findSessionByHash(tokenHash) {
      // منفذ pre-auth ضيق: سياسة session_exact_lookup تطابق الهاش حصراً
      const row = await withLookupPrisma(client, [["app.session_hash", tokenHash]], (tx) =>
        tx.session.findFirst({ where: { token_hash: tokenHash } }));
      return row === null ? null : sessionFromRow(row);
    },

    async revokeSession(sessionId, tenantId, revokedAt) {
      // التقييد بالمستأجر داخل المعاملة — لا إلغاء عرضي لجلسة مستأجر آخر
      return withTenantPrisma(client, tenantId, async (tx) => {
        const result = await tx.session.updateMany({ where: { id: sessionId, tenant_id: tenantId, revoked_at: null }, data: { revoked_at: new Date(revokedAt) } });
        return result.count === 1;
      });
    },

    async rotateSession(expectedId, next) {
      return withTenantPrisma(client, next.tenantId, async (tx) => {
        const changed = await tx.session.updateMany({ where: { id: expectedId, tenant_id: next.tenantId, revoked_at: null }, data: { revoked_at: new Date() } });
        if (changed.count !== 1) return false;
        await tx.session.create({ data: { id: next.sessionId, token_hash: next.tokenHash, csrf_hash: next.csrfHash, browser_binding_hash: next.browserBindingHash, identity_id: next.identityId, auth_method: next.authMethod, membership_id: next.membershipId, tenant_id: next.tenantId, permissions: [...next.permissions], authorization_version: next.authorizationVersion, idle_expires_at: new Date(next.idleExpiresAt), absolute_expires_at: new Date(next.absoluteExpiresAt), revoked_at: null } });
        return true;
      });
    },

    // معاملات الدخول: كتابة بنطاق المستأجر واستهلاك ذري pre-auth
    async putLoginTransaction(record) {
      await withTenantPrisma(client, record.tenantId, async (tx) => {
        await tx.loginTransaction.create({ data: { id: record.transactionId, state_hash: record.stateHash, browser_binding_hash: record.browserBindingHash, tenant_id: record.tenantId, config_version: record.configVersion, config_instance_id: record.configInstanceId, nonce: record.nonce, verifier_envelope: record.verifierEnvelope, redirect_uri: record.redirectUri, return_path: record.returnPath, expires_at: new Date(record.expiresAt), consumed_at: null } });
      });
    },

    async consumeLoginTransaction(stateHash, consumedAt) {
      return withLookupPrisma(client, [["app.state_hash", stateHash]], async (tx) => {
        const changed = await tx.loginTransaction.updateMany({ where: { state_hash: stateHash, consumed_at: null }, data: { consumed_at: new Date(consumedAt) } });
        if (changed.count !== 1) return null;
        const row = await tx.loginTransaction.findFirst({ where: { state_hash: stateHash } });
        return row === null ? null : transactionFromRow(row);
      });
    },
  };
}
