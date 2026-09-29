/**
 * بناء بيئة التشغيل لأوامر الإدارة — نمطان حصراً:
 * - memory: مخازن داخلية للتطوير/الاختبار — يُرفض صراحة في الإنتاج.
 * - live: PostgreSQL حقيقي عبر Prisma فوق دور ab_app المقيد (FORCE RLS).
 * اتصال المشغّل (ADMIN_DATABASE_URL) يمر عبر البيئة أو ملف سر صريح
 * (ADMIN_DATABASE_URL_FILE) حصراً — لا وسائط أوامر إطلاقاً،
 * ويُستهلك للعد الإداري لحارس bootstrap حصراً — لا كتابة إدارية عبره.
 */

import { readFileSync } from "node:fs";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type {
  AuthStore, RunArchiveStore, SemanticStore, TenantLifecycleStore,
} from "@agentbridge/memory";
import {
  createInMemoryAuthStore, createInMemorySemanticStore, createInMemoryRunArchiveStore,
  createInMemoryDeletionOperationStore,
  type InMemoryAuthStore, type InMemorySemanticStore,
} from "@agentbridge/memory";
import {
  HashChainAuditLog, assertRestrictedRole, createPrismaAuthStore, createPrismaRunArchiveStore,
  createPrismaSemanticStore, createPrismaTenantLifecycle, createPrismaDeletionOperationStore,
} from "@agentbridge/infra";
import { OpsError, sanitizeErrorText } from "./ops-common.js";

/** مخطط بيئة أوامر الإدارة — الأدنى اللازم بلا مفاتيح خدمة زائدة */
const OpsEnvSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  ADMIN_DATABASE_URL: z.string().min(1).optional(),
  ADMIN_DATABASE_URL_FILE: z.string().min(1).optional(),
});

export interface OpsStores {
  readonly semantic: SemanticStore;
  readonly auth: AuthStore;
  readonly lifecycle: TenantLifecycleStore;
  readonly audit: HashChainAuditLog;
  readonly archives: RunArchiveStore;
  /** سجل عمليات الحذف — سياج فعلي دائم فوق PostgreSQL أو الذاكرة */
  readonly deletionOperations: import("@agentbridge/memory").DeletionOperationStore;
  /** عميل الحي — null في النمط الداخلي */
  readonly prisma: PrismaClient | null;
  /** العد الإداري لحارس bootstrap — null في النمط الداخلي أو بلا اتصال مشغّل */
  readonly adminPrisma: PrismaClient | null;
  close(): Promise<void>;
}

/** مخازن النمط الداخلي بأنواعها الملموسة — عمليات الحذف متاحة للتراجع الذري */
export interface OpsMemoryStores extends OpsStores {
  readonly semantic: InMemorySemanticStore;
  readonly auth: InMemoryAuthStore;
}

/** يبني مخازن النمط الداخلي — تطوير/اختبار فقط */
export async function buildMemoryStores(): Promise<OpsMemoryStores> {
  const semantic = createInMemorySemanticStore();
  const auth = createInMemoryAuthStore();
  // L3/L4 داخلياً بلا سطح مسح — رفض صريح بدل انفجار؛ سياسة "permanent"
  // لا تطلبها أصلاً ومسحها الفعلي في النمط الحي حصراً
  const lifecycle: TenantLifecycleStore = {
    ...semantic,
    ...auth,
    purgeExpiredVectorEmbeddings: () => Promise.reject(new OpsError(2, "النمط الداخلي بلا سطح مسح لـL3 — استخدم --store live")),
    purgeExpiredFlywheelLessons: () => Promise.reject(new OpsError(2, "النمط الداخلي بلا سطح مسح لـL4 — استخدم --store live")),
  };

  return {
    semantic, auth,
    lifecycle,
    audit: new HashChainAuditLog(semantic),
    archives: createInMemoryRunArchiveStore(),
    deletionOperations: createInMemoryDeletionOperationStore(),
    prisma: null, adminPrisma: null,
    async close() { /* لا موارد داخلية تُغلق */ },
  };
}

/** يقرأ DSN الإدارة من البيئة أو ملف سر صريح — لا وسائط أوامر */
function readAdminDatabaseUrl(): string | undefined {
  if (process.env.ADMIN_DATABASE_URL !== undefined && process.env.ADMIN_DATABASE_URL.length > 0) {
    return process.env.ADMIN_DATABASE_URL;
  }
  const filePath = process.env.ADMIN_DATABASE_URL_FILE;
  if (filePath === undefined || filePath.length === 0) return undefined;
  const content = readFileSync(filePath, "utf8").trim();
  if (content.length === 0) {
    throw new OpsError(2, `ملف اتصال الإدارة فارغ: ${filePath} — اكتب DSN واحداً فيه`);
  }
  return content;
}

/** يبني المخازن الحية — يفشل fail-closed بلا DATABASE_URL وبلا تحقق دور */
export async function buildLiveStores(): Promise<OpsStores> {
  const env = OpsEnvSchema.safeParse(process.env);
  if (!env.success || env.data.DATABASE_URL === undefined) {
    throw new OpsError(2, "DATABASE_URL مطلوب للنمط الحي — مرره عبر البيئة لا وسائط الأوامر (القاعدة 15)");
  }
  // استيراد كسول: النمط memory لا يحمل عميل Prisma إطلاقاً
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: env.data.DATABASE_URL } } });
  await assertRestrictedRole(prisma);
  const adminUrl = readAdminDatabaseUrl();
  const adminPrisma = adminUrl === undefined ? null : new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const semantic = createPrismaSemanticStore(prisma);
  return {
    semantic, auth: createPrismaAuthStore(prisma),
    lifecycle: createPrismaTenantLifecycle(prisma),
    audit: new HashChainAuditLog(semantic),
    archives: createPrismaRunArchiveStore(prisma),
    deletionOperations: createPrismaDeletionOperationStore(prisma),
    prisma, adminPrisma,
    async close() {
      await prisma.$disconnect();
      if (adminPrisma !== null) await adminPrisma.$disconnect();
    },
  };
}

/** رسالة خطأ موحدة منقية — لا DSN يصل إلى stderr إطلاقاً */
export function sanitizedFailure(error: unknown): string {
  return sanitizeErrorText(String((error as { message?: string }).message ?? error));
}
