/**
 * onboarding الحي فوق PostgreSQL — معاملة RLS واحدة ذرية تشمل التدقيق.
 *
 * كيف تكون ذرياً بلا سياسات جديدة: كل الصفوف الأربعة ووصل التدقيق تُكتب
 * داخل معاملة واحدة يضبط فيها `app.tenant_id` (سياسة tenant_isolation
 * تشترطه على كل جدول تشغيلي) و`app.identity_write` و
 * `app.identity_issuer/subject` (سياسات الهوية pre-auth) — وهي مفاتيح
 * القائمة البيضاء نفسها التي تستخدمها المحولات الحية، فلا باب RLS
 * جديداً ولا تخفيف للعزل. إما يكتمل كل شيء (بما فيه وصل التدقيق) أو
 * يتراجع الكل — لا حالة جزئية ولا اعتماد فعال بلا تدقيق.
 *
 * حارس bootstrap الأول: عد مستأجري المسؤول يستلزم رؤية عابرة
 * للمستأجرين لا يمنحها دور ab_app المقيد عمداً؛ لذلك يمر `--initial`
 * بقفل `pg_advisory_xact_lock` ثابت داخل معاملة الكتابة نفسها قبل عد
 * اتصال المشغّل — عمليتان متوازيتان تتصاران على القفل فتبدأ الثانية
 * عدّها بعد التزام الأولى، فترى المستأجر وترفض برمز ثابت. لا يعتمد
 * المنع على فحص تطبيقي سابق فقط.
 */

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { withLookupPrisma } from "./prisma-scope.js";
import { lastAuditEntryWithTx, appendAuditEntryWithTx } from "./prisma-semantic-store.js";
import { buildChainedAuditEntry } from "./audit-chain.js";
import {
  expiryFromNow, issueApiKey, validateOnboardingInput,
  onboardingAuditPayload, OnboardingError,
  type OnboardingInput, type OnboardingResult, type OnboardingSecret,
} from "./tenant-onboarding.js";

/** مفتاحا القفل الاستشاري الثابتان لعملية bootstrap — ثبات لا اشتقاق عشوائي */
const BOOTSTRAP_LOCK_KEY1 = 1_099_511_627; // hashtext ثابت لـ"agentbridge:bootstrap"
const BOOTSTRAP_LOCK_KEY2 = 771_850_701; // hashtext ثابت لـ"initial-admin-tenant"

/** حارس bootstrap: يمنع إعادة إنشاء أول مسؤول — يتطلب اتصال مشغّل للعد */
export async function assertBootstrapAvailable(adminClient: PrismaClient | null, input: OnboardingInput): Promise<void> {
  if (input.initial !== true) return;
  if (adminClient === null) {
    throw new OnboardingError("BOOTSTRAP_DONE", "خيار --initial يتطلب اتصال مشغّل (مالك الجداول) لعد مستأجري المسؤول — مرر ADMIN_DATABASE_URL عبر البيئة أو أسقط --initial");
  }
  // المحذوف ناعمًا ليس مستأجر مسؤول قائمًا — إدخاله في العد يقفل bootstrap
  // إلى الأبد بعد حذف أول مستأجر فلا يستطيع المشغّل إنشاء أي مستأجر جديد
  const rows = await adminClient.$queryRawUnsafe<{ count: string }[]>("SELECT count(*)::text AS count FROM tenants WHERE is_admin = true AND deleted_at IS NULL");
  const adminCount = Number(rows[0]?.count ?? "0");
  if (adminCount > 0) {
    throw new OnboardingError("BOOTSTRAP_DONE", `bootstrap الأول تم سابقاً (${adminCount} مستأجر مسؤول) — الدوران عبر إصدار اعتماد جديد لا إعادة bootstrap`);
  }
}

/** يصنف خطأ قاعدة بيانات إلى رمز رفض دقيق — لا يعاد تفسير كل فشل كوجود */
function classifyDbError(error: unknown): OnboardingError {
  const prismaError = error as { code?: string; meta?: { target?: string[] }; message?: string };
  if (prismaError.code === "P2002") {
    const target = (prismaError.meta?.target ?? []).join(",");
    if (target.includes("id") && !target.includes("issuer")) {
      return new OnboardingError("TENANT_EXISTS", "المستأجر موجود مسبقاً (تعارض قيد فريد داخل المعاملة) — منع التكرار fail-closed");
    }
    if (target.includes("issuer") || target.includes("subject")) {
      return new OnboardingError("OWNER_EXISTS", "هوية المالك مسجلة مسبقاً (تعارض قيد فريد داخل المعاملة) — منع bootstrap متكرر");
    }
    return new OnboardingError("TENANT_EXISTS", "تعارض قيد فريد أثناء onboarding — تراجعت المعاملة كاملة (fail-closed)");
  }
  // أي فشل آخر عابر/بنية: رسالة منقية بلا تفاصيل قاعدة خام ولا DSN
  return new OnboardingError(
    "TRANSIENT_FAILURE",
    "فشل قاعدة بيانات أثناء onboarding الذري وتراجعت المعاملة كاملة — أعد المحاولة بعد التحقق من صحة الاتصال",
    3,
  );
}

/**
 * الـonboarding الحي الذري: تحقق ثم — داخل معاملة RLS واحدة — قفل
 * bootstrap الاستشاري، فحصا الوجود، كتابة الأربعة، ووصل التدقيق.
 * فشل أي خطوة (بما فيها التدقيق) يتراجع عن الكل.
 */
export async function onboardTenantLive(adminClient: PrismaClient | null, client: PrismaClient, input: OnboardingInput): Promise<OnboardingResult & OnboardingSecret> {
  validateOnboardingInput(input);
  const identityId = `ident-${randomUUID()}`;
  const membershipId = `member-${randomUUID()}`;
  const credentialId = `bootstrap-${input.tenantId}`;
  const createdAt = input.nowIso;
  const expiresAt = expiryFromNow(input.expiresInDays, createdAt);
  const auditCorrelationId = randomUUID();
  const { apiKey, hash } = await issueApiKey();
  // hash خامد مستقل عن الاعتماد: لا يعمل كأي مفتاح ولا يحيي مسار legacy
  const { hash: dormantHash } = await issueApiKey();

  try {
    await withLookupPrisma(client, [
      ["app.tenant_id", input.tenantId],
      ["app.identity_write", "1"],
      ["app.identity_issuer", input.ownerIssuer],
      ["app.identity_subject", input.ownerSubject],
    ], async (tx) => {
      // قفل استشاري ثابت داخل معاملة الكتابة — يتصارن عليه كل
      // منادي `--initial` فلا يرى الثاني عدّاً قبل التزام الأول كاملاً.
      // التغليف بقيمة صريحة لأن Prisma لا يفك عمود void الخام
      if (input.initial === true) {
        await tx.$queryRaw<{ acquired: number }[]>`SELECT (pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY1}::int, ${BOOTSTRAP_LOCK_KEY2}::int) IS NULL)::int AS acquired`;
        await assertBootstrapAvailable(adminClient, input);
      }
      // فحصا الوجود داخل المعاملة نفسها — لا نافذة سباق بين الفحص والكتابة
      const tenantExists = await tx.tenant.findFirst({ where: { id: input.tenantId } });
      if (tenantExists !== null) {
        throw new OnboardingError("TENANT_EXISTS", `المستأجر موجود مسبقاً: ${input.tenantId} — منع التكرار fail-closed`);
      }
      const ownerExists = await tx.externalIdentity.findFirst({ where: { issuer: input.ownerIssuer, subject: input.ownerSubject } });
      if (ownerExists !== null) {
        throw new OnboardingError("OWNER_EXISTS", `هوية المالك مسجلة مسبقاً (${input.ownerIssuer}/${input.ownerSubject}) — منع bootstrap متكرر`);
      }
      await tx.tenant.create({ data: { id: input.tenantId, name: input.tenantName.trim(), api_key_hash: dormantHash, is_admin: input.initial === true, created_at: new Date(createdAt) } });
      await tx.externalIdentity.create({ data: { id: identityId, issuer: input.ownerIssuer, subject: input.ownerSubject, created_at: new Date(createdAt) } });
      await tx.membership.create({ data: { id: membershipId, identity_id: identityId, tenant_id: input.tenantId, role: "tenant_admin", status: "active", authorization_version: 1 } });
      await tx.apiCredential.create({ data: { id: credentialId, tenant_id: input.tenantId, subject_id: `service:${input.tenantId}`, key_hash: hash, permissions: [...input.credentialPermissions], authorization_version: 1, revoked_at: null, expires_at: new Date(expiresAt) } });
      // وصل التدقيق داخل المعاملة نفسها — الاعتماد لا يصير فعالاً
      // إلا مع وصل تدقيق ملتزم في نفس الذرية؛ فشل التدقيق يتراجع عن الكل
      const tail = await lastAuditEntryWithTx(tx, input.tenantId);
      const entry = buildChainedAuditEntry({
        tenantId: input.tenantId,
        runId: auditCorrelationId,
        stage: "tenant_onboarding",
        decision: "granted",
        abstractedPayload: onboardingAuditPayload({
          tenantId: input.tenantId, credentialId, subjectId: `service:${input.tenantId}`,
          permissions: [...input.credentialPermissions], expiresAt,
          auditCorrelationId, membershipId, identityId, ownerRole: "tenant_admin",
        }),
        at: new Date().toISOString(),
      }, tail);
      await appendAuditEntryWithTx(tx, entry);
    });
  } catch (error) {
    if (error instanceof OnboardingError) throw error;
    throw classifyDbError(error);
  }

  return {
    tenantId: input.tenantId, credentialId, subjectId: `service:${input.tenantId}`,
    permissions: [...input.credentialPermissions], expiresAt,
    auditCorrelationId, membershipId, identityId, ownerRole: "tenant_admin", apiKey,
  };
}
