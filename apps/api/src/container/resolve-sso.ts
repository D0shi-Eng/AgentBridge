/**
 * دالة حل مخزن SSO — تفصل منطق اختيار InMemory مقابل Live
 * عن تجميع الحاوية الرئيسي لتبقي container.ts ≤200 سطر.
 */

import type { SsoStore } from "@agentbridge/infra";
import { createInMemorySsoStore } from "@agentbridge/infra";
import { createPrismaSsoStore } from "@agentbridge/infra";
import type { PrismaClient } from "@prisma/client";

/** يحل مخزن SSO — حالياً InMemory دائماً مع خيار Live للمستقبل */
export function resolveSso(
  ssoOverride: SsoStore | undefined,
  prisma: PrismaClient | undefined,
): SsoStore {
  if (ssoOverride !== undefined) return ssoOverride;
  if (prisma !== undefined) return createPrismaSsoStore(prisma);
  return createInMemorySsoStore();
}