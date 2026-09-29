/**
 * نقطة توافق اسمية: لم يعد OIDC اعتماد Bearer للمسارات.
 * التحقق أصبح داخل callback فقط، ثم تصدر جلسة opaque يملكها auth.plugin.
 */
import type { FastifyInstance } from "fastify";
import type { SsoStore } from "@agentbridge/infra";

/** لا يسجل hook عمداً؛ وجوده يمنع المستهلكين القدماء من إعادة قبول JWT. */
export function registerSsoPlugin(_app: FastifyInstance, _store: SsoStore): void {
  // لا عمل: المسار القديم ألغي أمنيًا ولا يوجد fallback متوافق.
}
