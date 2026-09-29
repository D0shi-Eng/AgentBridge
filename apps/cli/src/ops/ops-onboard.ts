/**
 * أمر `onboard-tenant` — إنشاء مستأجر إنتاجي بمالك واعتماد أولي مقيّد.
 *
 * أمان المفتاح الخام: المفتاح لا يظهر إلا عبر قناة معتمدة واحدة —
 * ملف صريح بـ`--secret-output` (إنشاء ذري بلا overwrite) أو عرض TTY
 * مرة واحدة؛ stdout غير التفاعلي يُرفض fail-closed. لا يطبع أي سطر
 * Authorization يحمل السر، والمعرفات (credentialId/expiresAt) تُعرض
 * منفصلة عن السر.
 */

import type { PrismaClient } from "@prisma/client";
import type { Permission } from "@agentbridge/shared";
import type { OnboardingInput, OnboardingResult, OnboardingSecret } from "@agentbridge/infra";
import {
  OnboardingError, onboardTenantLive, onboardTenantMemoryAtomic,
} from "@agentbridge/infra";
import { buildLiveStores, buildMemoryStores, type OpsMemoryStores, type OpsStores } from "./ops-runtime.js";
import {
  OpsError, discloseSecret, hasFlag, optionalOne, parseCommandArgs, requireOne, requireStore,
} from "./ops-common.js";

/** القائمة المسموحة لأمر onboarding — أي علم آخر يرفض */
const ONBOARD_SPEC = {
  flags: {
    tenant: "single", name: "single", issuer: "single", subject: "single",
    permissions: "single", "expires-in-days": "single",
    initial: "one", store: "single", "secret-output": "single",
  },
} as const;

/** دالة الـonboarding الذرية الموحدة فوق المحولين (الداخلي والحي) */
type OnboardFn = (input: OnboardingInput) => Promise<OnboardingResult & OnboardingSecret>;

export async function runOnboardTenant(argv: readonly string[]): Promise<number> {
  const args = parseCommandArgs(argv, ONBOARD_SPEC);
  const initial = hasFlag(args, "initial");
  const input: OnboardingInput = {
    tenantId: requireOne(args, "tenant"),
    tenantName: requireOne(args, "name"),
    ownerIssuer: requireOne(args, "issuer"),
    ownerSubject: requireOne(args, "subject"),
    credentialPermissions: requireOne(args, "permissions").split(",").map((p) => p.trim()).filter((p) => p.length > 0) as Permission[],
    expiresInDays: Number(requireOne(args, "expires-in-days")),
    nowIso: new Date().toISOString(),
    ...(initial ? { initial: true } : {}),
  };
  // --store إلزامية صراحة: لا fallback صامت بين memory وlive
  const store = requireStore(args);
  const stores: OpsStores = store === "live" ? await buildLiveStores() : await memoryStoresGuarded();

  try {
    // المسار الحي: الكتابة والتدقيق داخل معاملة RLS واحدة؛
    // المسار الداخلي: onboarding ثم تدقيق مع تراجع دقيق عند فشل التدقيق
    const onboard: OnboardFn = store === "live"
      ? (candidate) => onboardTenantLive(stores.adminPrisma, requirePrisma(stores.prisma), candidate)
      : (candidate) => onboardTenantMemoryAtomic(stores as OpsMemoryStores, stores.audit, candidate);
    const result = await onboard(input);
    discloseSecret({
      secret: result.apiKey,
      credentialId: result.credentialId,
      expiresAt: result.expiresAt,
      auditCorrelationId: result.auditCorrelationId,
      ...(optionalOne(args, "secret-output") !== undefined ? { secretOutputPath: optionalOne(args, "secret-output") } : {}),
    });
    return 0;
  } catch (error) {
    if (error instanceof OnboardingError) {
      process.stderr.write(`رفض onboarding [${error.code}]: ${error.message}\n`);
      return error.exitCode;
    }
    throw error;
  } finally {
    await stores.close();
  }
}

/** يضيق وجود عميل الحي برسالة تشغيلية واضحة بدل تأكيد أعمى */
function requirePrisma(prisma: PrismaClient | null): PrismaClient {
  if (prisma === null) throw new OpsError(2, "النمط live يتطلب PrismaClient — تحقق من DATABASE_URL");
  return prisma;
}

/** النمط الداخلي مرفوض في الإنتاج — الفحص في مساره الوحيد */
async function memoryStoresGuarded(): Promise<OpsMemoryStores> {
  if (process.env.NODE_ENV === "production") {
    throw new OpsError(2, "النمط memory مرفوض في الإنتاج — استخدم --store live فوق PostgreSQL حقيقية");
  }
  return buildMemoryStores();
}
