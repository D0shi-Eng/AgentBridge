/**
 * دالة حل مخزن Flywheel — تفصل منطق اختيار InMemory مقابل Live
 * عن تجميع الحاوية الرئيسي لتبقي container.ts ≤200 سطر.
 */

import type { AppConfig } from "@agentbridge/infra";
import type { FlywheelStore, VectorStore } from "@agentbridge/memory";
import { createInMemoryFlywheelStore } from "@agentbridge/memory";
import { createPrismaFlywheelStore } from "@agentbridge/infra";
import type { PrismaClient } from "@prisma/client";

/** يحل مخزن Flywheel حسب نمط الاستدامة */
export function resolveFlywheel(
  config: AppConfig,
  flywheelOverride: FlywheelStore | undefined,
  vectorStore: VectorStore,
  prisma: PrismaClient | undefined,
): FlywheelStore {
  if (flywheelOverride !== undefined) return flywheelOverride;
  if (config.persistence === "live" && prisma !== undefined) return createPrismaFlywheelStore(prisma, vectorStore);
  return createInMemoryFlywheelStore(vectorStore);
}