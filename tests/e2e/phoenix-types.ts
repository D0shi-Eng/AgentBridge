/** أنواع مشتركة لاختبار الطيور الحي — تُستورد من حزمة api مباشرة */
import { randomUUID } from "node:crypto";
import type { buildApp } from "@agentbridge/api";
import type { seedTenant } from "@agentbridge/api/test-helpers";

export type App = Awaited<ReturnType<typeof buildApp>>;
export type Tenant = Awaited<ReturnType<typeof seedTenant>>;
/** معرف المستأجر لهذه الجلسة — ثابت للملفين (spec + helpers) */
export const TENANT_ID = `phoenix-live-${randomUUID().slice(0, 8)}`;
