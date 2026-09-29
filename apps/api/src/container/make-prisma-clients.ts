/**
 * دوال إنشاء عملاء Prisma — تفصل منطق إنشاء العميل
 * عن تجميع الحاوية الرئيسي لتبقي container.ts ≤200 سطر.
 */

import { PrismaClient } from "@prisma/client";
import type { AppConfig } from "@agentbridge/infra";

/** ينشئ عميل Prisma للإنتاج عند توفر إعدادات القاعدة */
export function makePrismaClient(config: AppConfig): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
}