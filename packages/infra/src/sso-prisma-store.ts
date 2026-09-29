/**
 * محول SSO الحي فوق Prisma — ذرية CAS مركبة.
 *
 * كل عملية إدارية داخل معاملة واحدة: قفل الصف (SELECT … FOR UPDATE) ثم
 * قراءة (الهوية، الإصدار) ثم المقارنة المركبة ثم التنفيذ ثم رفع الإصدار
 * داخل المعاملة نفسها — لا قراءة خارج معاملة وكتابة داخل أخرى.
 * معاملات المستأجر عبر withTenantPrisma (RLS) وكل تحويل عبر المبدئو حصراً.
 */
import type { PrismaClient } from "@prisma/client";
import type { SsoCasExpectation, SsoConfigWriteInput, SsoStore } from "./sso-store.js";
import { generateConfigInstanceId, publicConfig, SsoConfigConflictError, SsoConfigNotFoundError } from "./sso-store.js";
import { ssoCreateRow, ssoFromRow, ssoUpdateRow, type SsoConfigRow } from "./sso-mappers.js";
import { withTenantPrisma } from "./prisma-scope.js";

interface LockedRow {
  readonly config_instance_id: string;
  readonly config_version: number;
}

export function createPrismaSsoStore(client: PrismaClient): SsoStore {
  return {
    async get(tenantId) {
      const row = await withTenantPrisma(client, tenantId, (tx) =>
        tx.ssoConfig.findUnique({ where: { tenant_id: tenantId } }));
      return row === null ? null : publicConfig(ssoFromRow(row));
    },
    async getPrivate(tenantId) {
      const row = await withTenantPrisma(client, tenantId, (tx) =>
        tx.ssoConfig.findUnique({ where: { tenant_id: tenantId } }));
      return row === null ? null : ssoFromRow(row);
    },

    /** create: قفل (لا صف) ثم توليد هوية خادمية وإدراج — سباق الإنشاء تعارض */
    async create(config: SsoConfigWriteInput) {
      return withTenantPrisma(client, config.tenantId, async (tx) => {
        const locked = await tx.$queryRawUnsafe<Array<LockedRow>>(
          `SELECT "config_instance_id","config_version" FROM "sso_configs" WHERE "tenant_id"=$1 FOR UPDATE`,
          config.tenantId,
        );
        if (locked.length > 0) throw new SsoConfigConflictError();
        const created = await tx.ssoConfig.create({ data: ssoCreateRow(config, generateConfigInstanceId()) });
        return publicConfig(ssoFromRow(created as SsoConfigRow & { enabled: boolean; created_at: Date }));
      });
    },

    /** update: قفل، مقارنة (الهوية + الإصدار) معاً، كتابة بلا هوية، رفع الإصدار */
    async update(config: SsoConfigWriteInput, expectation: SsoCasExpectation) {
      return withTenantPrisma(client, config.tenantId, async (tx) => {
        const locked = await tx.$queryRawUnsafe<Array<LockedRow>>(
          `SELECT "config_instance_id","config_version" FROM "sso_configs" WHERE "tenant_id"=$1 FOR UPDATE`,
          config.tenantId,
        );
        const current = locked[0];
        if (current === undefined) throw new SsoConfigNotFoundError();
        if (current.config_instance_id !== expectation.expectedInstanceId ||
            current.config_version !== expectation.expectedVersion) {
          throw new SsoConfigConflictError();
        }
        const nextVersion = current.config_version + 1;
        const row = ssoUpdateRow(config, nextVersion);
        const saved = await tx.ssoConfig.update({ where: { tenant_id: config.tenantId }, data: { ...row } });
        return publicConfig(ssoFromRow(saved as SsoConfigRow & { enabled: boolean; created_at: Date }));
      });
    },

    /** delete: قفل ومقارنة مركبة اختيارية — false للغياب ورمي للتعارض */
    async delete(tenantId: string, expectation?: SsoCasExpectation) {
      return withTenantPrisma(client, tenantId, async (tx) => {
        const locked = await tx.$queryRawUnsafe<Array<LockedRow>>(
          `SELECT "config_instance_id","config_version" FROM "sso_configs" WHERE "tenant_id"=$1 FOR UPDATE`,
          tenantId,
        );
        const current = locked[0];
        if (current === undefined) return false;
        if (expectation !== undefined &&
            (current.config_instance_id !== expectation.expectedInstanceId ||
             current.config_version !== expectation.expectedVersion)) {
          throw new SsoConfigConflictError();
        }
        await tx.ssoConfig.deleteMany({ where: { tenant_id: tenantId } });
        return true;
      });
    },
  };
}
