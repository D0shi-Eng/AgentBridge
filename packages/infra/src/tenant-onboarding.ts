/**
 * onboarding الإنتاجي للمستأجر — البديل الرسمي لـdev-seed.
 *
 * مسار واحد فقط: CLI إداري محلي (`agentbridge-ops`) فوق هذه الخدمة —
 * لا endpoint عام ولا onboarding مجهول عبر الإنترنت، وdev-seed يبقى
 * في tests/e2e حصراً مع رفض صريح لوضع الإنتاج.
 *
 * الضمانات:
 * - المسار الحي (prisma-tenant-onboarding): المستأجر والهوية والعضوية
 *   والاعتماد ووصل التدقيق كلها في معاملة RLS واحدة — ذرية تماماً بلا
 *   حالة جزئية ولا اعتماد فعال قبل نجاح التدقيق.
 * - المسار الداخلي (للاختبار/التطوير): `onboardTenantMemoryAtomic`
 *   ينفذ الكتابة المتسلسلة ثم التدقيق، وفشل التدقيق يتراجع بدقة عن
 *   السجلات الأربعة المولدة حديثاً بمفاتيحها المعروفة — النظام أحادي
 *   الخيط فالتراجع بالمفاتيح يعادل ذرية المعاملة.
 * - حارس bootstrap الأول: `initial` يرفض إن وُجد مستأجر مسؤول سابق،
 *   والمسار الداخلي يسلسل عمليات الـonboarding في العملية الواحدة فلا
 *   سباق بين الفحص والكتابة (والحي يقفله بقفل advisory).
 * - المفتاح الخام يولد ويُعرض مرة واحدة في نتيجة النداء؛ المخزن يحفظ
 *   hash scrypt حصراً، والتدقيق يسجل المعرف والنطاقات بلا أي سر.
 * - الاعتماد نطاقاته مقيدة صراحة وصلاحيته إلزامية — لا اعتماد دائم صامت.
 * - duplicate tenant / duplicate owner / معرف اعتماد مكرر = رفض fail-closed،
 *   وأخطاء قاعدة البيانات العابرة تُصنف صنفاً مستقلاً لا يعاد تفسيره
 *   كتعارض وجود.
 */

import { randomUUID } from "node:crypto";
import { PermissionSchema, type LifecycleAuditStage, type Permission } from "@agentbridge/shared";
import type { TenantLifecycleStore } from "@agentbridge/memory";
import { generateApiKey, hashApiKeyAsync } from "./crypto.js";

/** مدخل الـonboarding — كل الحقول إلزامية عمداً فلا افتراضات صامتة */
export interface OnboardingInput {
  readonly tenantId: string;
  readonly tenantName: string;
  /** هوية المالك الخارجية (SSO) — issuer+subject فريدان عالمياً */
  readonly ownerIssuer: string;
  readonly ownerSubject: string;
  /** نطاقات اعتماد الخدمة — قائمة صريحة مقيّدة، لا قبول شامل */
  readonly credentialPermissions: readonly Permission[];
  /** صلاحية الاعتماد بالأيام (1–730) — إلزامية؛ الدوران بإصدار جديد وإلغاء قديم */
  readonly expiresInDays: number;
  /** bootstrap أول مسؤول — يرفض إن سبق إنشاء مستأجر مسؤول */
  readonly initial?: boolean;
  readonly nowIso: string;
}

export interface OnboardingSecret {
  /** المفتاح الخام — يظهر هنا مرة واحدة ولا يُسجل ولا يُدقق ولا يُخزن */
  readonly apiKey: string;
}

export interface OnboardingResult {
  readonly tenantId: string;
  readonly credentialId: string;
  readonly subjectId: string;
  readonly permissions: readonly Permission[];
  readonly expiresAt: string;
  /** المعرف الارتباطي لحدث التدقيق — المفتاح الخام لا يدخل التدقيق إطلاقاً */
  readonly auditCorrelationId: string;
  readonly membershipId: string;
  readonly identityId: string;
  readonly ownerRole: "tenant_admin";
}

/** رموز الرفض المصنفة — كل رمز برمز خروج مستقر */
export type OnboardingErrorCode =
  | "TENANT_EXISTS"
  | "OWNER_EXISTS"
  | "BOOTSTRAP_DONE"
  | "INVALID_PERMISSIONS"
  | "INVALID_TENANT_ID"
  | "INVALID_EXPIRY"
  | "TRANSIENT_FAILURE";

/** رموز الخروج: 2 رفض إدخال/وجود حاسم، 3 فشل عابر يستحق إعادة محاولة */
const EXIT_CODES = { input: 2, transient: 3 } as const;

export class OnboardingError extends Error {
  constructor(
    readonly code: OnboardingErrorCode,
    message: string,
    readonly exitCode: number = EXIT_CODES.input,
  ) {
    super(message);
  }
}

/** نمط معرف المستأجر: أحرف إنجليزية صغيرة وأرقام وشرطات (3–64) */
const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/u;

/** التحقق المسبق المشترك بين المحولين — نقية وقابلة للاختبار مباشرة */
export function validateOnboardingInput(input: OnboardingInput): void {
  if (!TENANT_ID_PATTERN.test(input.tenantId)) {
    throw new OnboardingError("INVALID_TENANT_ID", `معرف المستأجر غير صالح: ${input.tenantId} — الأحرف الصغيرة والأرقام والشرطات (3–64) فقط`);
  }
  if (input.tenantName.trim().length === 0) {
    throw new OnboardingError("INVALID_TENANT_ID", "اسم المستأجر مطلوب ولا يكون فارغاً");
  }
  if (!Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > 730) {
    throw new OnboardingError("INVALID_EXPIRY", `صلاحية الاعتماد يجب أن تكون 1–730 يوماً: ${String(input.expiresInDays)}`);
  }
  if (input.credentialPermissions.length === 0) {
    throw new OnboardingError("INVALID_PERMISSIONS", "نطاقات الاعتماد مطلوبة — لا اعتماد بلا نطاقات صريحة");
  }
  for (const permission of input.credentialPermissions) {
    if (!PermissionSchema.safeParse(permission).success) {
      throw new OnboardingError("INVALID_PERMISSIONS", `نطاق غير معروف: ${String(permission)} — القائمة المسموحة في packages/shared identity.ts`);
    }
    // الاعتماد الآلي لا يحمل أبداً صلاحيات إدارة الهوية — تباعد صلاحيات مقصود
    if (permission === "sso:manage" || permission === "tenant:admin") {
      throw new OnboardingError("INVALID_PERMISSIONS", `النطاق ${permission} غير مسموح لاعتماد خدمة آلية — صلاحيات الإدارة لهوية المالك عبر SSO حصراً`);
    }
  }
  if (input.ownerIssuer.trim().length === 0 || input.ownerSubject.trim().length === 0) {
    throw new OnboardingError("OWNER_EXISTS", "هوية المالك (issuer وsubject) مطلوبة ولا تكون فارغة");
  }
}

/** حساب توقيت انتهاء الاعتماد من مدد الأيام */
export function expiryFromNow(expiresInDays: number, nowIso: string): string {
  return new Date(Date.parse(nowIso) + expiresInDays * 86_400_000).toISOString();
}

/** منفذ التخزين الأدنى الذي يحتاجه التنفيذ الداخلي — يطابق منافذ memory بنيوياً */
export interface OnboardingStoreDeps {
  readonly semantic: {
    getTenant(tenantId: string): Promise<{ tenantId: string } | null>;
    createTenant(record: { tenantId: string; name: string; apiKeyHash: string; isAdmin?: boolean; createdAt: string }): Promise<void>;
    /** حذف المستأجر بالمفتاح — لتراجع المسار الذري الداخلي */
    deleteTenant(tenantId: string): Promise<void>;
  };
  readonly auth: {
    findExternalIdentity(issuer: string, subject: string): Promise<{ identityId: string } | null>;
    putExternalIdentity(record: { identityId: string; issuer: string; subject: string; createdAt: string }): Promise<void>;
    /** حذف هوية خارجية بمعرفها — لتراجع المسار الذري الداخلي */
    deleteExternalIdentityById(identityId: string): Promise<void>;
    findMembership(identityId: string, tenantId: string): Promise<{ membershipId: string } | null>;
    putMembership(record: { membershipId: string; identityId: string; tenantId: string; role: "tenant_admin"; status: "active"; authorizationVersion: number }): Promise<void>;
    deleteMembership(membershipId: string): Promise<void>;
    putApiCredential(record: { credentialId: string; tenantId: string; subjectId: string; keyHash: string; permissions: readonly Permission[]; authorizationVersion: number; expiresAt: string }): Promise<void>;
    deleteApiCredential(credentialId: string): Promise<void>;
  };
  readonly lifecycle: Pick<TenantLifecycleStore, "countAdminTenants">;
}

/** سجل التراجع: مغلق يحذف السجل المنشأ حديثاً بمفتاحه المعروف */
type UndoStep = () => Promise<void> | void;

/**
 * طابور تسلسل عمليات الـonboarding الداخلية داخل العملية الواحدة —
 * الفحص والكتابة يمران متتابعين فلا نافذة سباق بين countAdminTenants
 * والإنشاء (للنمط الداخلي؛ النمط الحي يقفله بقفل advisory فوق
 * PostgreSQL داخل معاملة الكتابة نفسها).
 */
let memoryOnboardQueue: Promise<unknown> = Promise.resolve();

function enqueueMemoryOnboard<T>(task: () => Promise<T>): Promise<T> {
  const run = memoryOnboardQueue.then(task, task);
  // فشل عملية لا يوقف عمليات اللاحقة — الخطأ ينتشر لمستدعيها فقط
  memoryOnboardQueue = run.catch(() => undefined);
  return run;
}

/** منفذ التراجع الدقيق المطلوب للمسار الذري الداخلي — حذف بالمفتاح المعروف */
export type OnboardingRollbackDeps = OnboardingStoreDeps;

/**
 * جوهر الكتابة الداخلية المشترك: تحقق كامل قبل أول كتابة ثم الكتابة
 * المتسلسلة. عندما تمرر سجلة تراجع تسجل كل كتابة ناجحة خطوة تراجع
 * بمفتاحها المعروف — فلا نسخة منطق منشقة بين المسارين.
 */
async function memoryOnboardCore(
  deps: OnboardingStoreDeps,
  input: OnboardingInput,
  undo?: UndoStep[],
): Promise<OnboardingResult & OnboardingSecret> {
  validateOnboardingInput(input);
  if (input.initial === true && (await deps.lifecycle.countAdminTenants()) > 0) {
    throw new OnboardingError("BOOTSTRAP_DONE", "bootstrap الأول تم سابقاً — يوجد مستأجر مسؤول؛ الدوران عبر إصدار اعتماد جديد لا إعادة bootstrap");
  }
  if ((await deps.semantic.getTenant(input.tenantId)) !== null) {
    throw new OnboardingError("TENANT_EXISTS", `المستأجر موجود مسبقاً: ${input.tenantId} — منع التكرار fail-closed`);
  }
  if ((await deps.auth.findExternalIdentity(input.ownerIssuer, input.ownerSubject)) !== null) {
    throw new OnboardingError("OWNER_EXISTS", `هوية المالك مسجلة مسبقاً (${input.ownerIssuer}/${input.ownerSubject}) — منع bootstrap متكرر`);
  }

  const identityId = `ident-${randomUUID()}`;
  const membershipId = `member-${randomUUID()}`;
  const credentialId = `bootstrap-${input.tenantId}`;
  const createdAt = input.nowIso;
  const expiresAt = expiryFromNow(input.expiresInDays, createdAt);
  const { apiKey, hash } = await issueApiKey();
  // hash خامد عشوائي مُهمَل: لو تساوى مع hash الاعتماد لأحيى مسار legacy
  // الترحيلي الاعتماد بعد حذفه — الخامد يمنع أي إحياء (fail-closed)
  const dormantHash = await hashApiKeyAsync(randomUUID());
  await deps.semantic.createTenant({ tenantId: input.tenantId, name: input.tenantName.trim(), apiKeyHash: dormantHash, isAdmin: input.initial === true, createdAt });
  undo?.push(() => deps.semantic.deleteTenant(input.tenantId));
  await deps.auth.putExternalIdentity({ identityId, issuer: input.ownerIssuer, subject: input.ownerSubject, createdAt });
  undo?.push(() => deps.auth.deleteExternalIdentityById(identityId));
  await deps.auth.putMembership({ membershipId, identityId, tenantId: input.tenantId, role: "tenant_admin", status: "active", authorizationVersion: 1 });
  undo?.push(() => deps.auth.deleteMembership(membershipId));
  await deps.auth.putApiCredential({ credentialId, tenantId: input.tenantId, subjectId: `service:${input.tenantId}`, keyHash: hash, permissions: [...input.credentialPermissions], authorizationVersion: 1, expiresAt });
  undo?.push(() => deps.auth.deleteApiCredential(credentialId));
  return {
    tenantId: input.tenantId, credentialId, subjectId: `service:${input.tenantId}`,
    permissions: [...input.credentialPermissions], expiresAt,
    auditCorrelationId: randomUUID(), membershipId, identityId, ownerRole: "tenant_admin", apiKey,
  };
}

/** تنفيذ داخل الذاكرة: تحقق كامل قبل أول كتابة ثم الكتابة المتسلسلة */
export async function onboardTenantInMemory(deps: OnboardingStoreDeps, input: OnboardingInput): Promise<OnboardingResult & OnboardingSecret> {
  return enqueueMemoryOnboard(() => memoryOnboardCore(deps, input));
}

/**
 * onboarding داخلي ذري مع التدقيق: فشل التدقيق بعد نجاح الكتابة
 * يتراجع حصراً عن السجلات الأربعة التي أنشأها هذا النداء (بمفاتيحها
 * المعروفة وبالترتيب العكسي) فلا يبقى مستأجر فعال بلا وصل تدقيق، ولا
 * يمس سجلات سابقة — وإعادة المحاولة بعد الإصلاح آمنة.
 */
export async function onboardTenantMemoryAtomic(
  deps: OnboardingRollbackDeps,
  audit: OnboardingAuditSink,
  input: OnboardingInput,
): Promise<OnboardingResult & OnboardingSecret> {
  return enqueueMemoryOnboard(async () => {
    const undo: UndoStep[] = [];
    try {
      const result = await memoryOnboardCore(deps, input, undo);
      await recordOnboardingAudit(audit, result, new Date().toISOString());
      return result;
    } catch (error) {
      // تراجع عكسي دقيق؛ فشل تراجع ثانوي لا يخفي الخطأ الأصلي
      for (const step of undo.reverse()) {
        try { await step(); } catch { /* التراجع الأفضل جهد — الخطأ الأصلي هو المعروض */ }
      }
      throw error;
    }
  });
}

/** منفذ تسجيل التدقيق — يطابق HashChainAuditLog بنيوياً (record فقط) */
export interface OnboardingAuditSink {
  record(input: { tenantId: string; runId: string; stage: LifecycleAuditStage; decision: string; abstractedPayload: string; at: string }): Promise<unknown>;
}

/** حمولة وصل التدقيق المشتركة — مجردة بلا أي سر (المفتاح لا يدخلها) */
export function onboardingAuditPayload(result: OnboardingResult): string {
  return JSON.stringify({
    event: "tenant.onboarding",
    credentialId: result.credentialId,
    subjectId: result.subjectId,
    permissions: [...result.permissions],
    expiresAt: result.expiresAt,
    ownerRole: result.ownerRole,
  });
}

/** يكتب وصل تدقيق الـonboarding — مستخدم من المسارين الداخلي والحي */
export async function recordOnboardingAudit(
  audit: OnboardingAuditSink,
  result: OnboardingResult,
  atIso: string,
): Promise<unknown> {
  return audit.record({
    tenantId: result.tenantId,
    runId: result.auditCorrelationId,
    stage: "tenant_onboarding",
    decision: "granted",
    abstractedPayload: onboardingAuditPayload(result),
    at: atIso,
  });
}

/** يولد المفتاح الخام وهاشه معاً — الخام يعيد مرة واحدة في النتيجة فقط */
export async function issueApiKey(): Promise<{ apiKey: string; hash: string }> {
  const apiKey = generateApiKey();
  return { apiKey, hash: await hashApiKeyAsync(apiKey) };
}
