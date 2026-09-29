/**
 * المصدر الوحيد لعنوان قاعدة التطوير الحية داخل حزمة infra.
 * البيئة أولاً (AB_LIVE_DATABASE_URL) ثم عنوان docker-compose.dev.yaml الموثق.
 */
export const LIVE_DATABASE_URL =
  process.env.AB_LIVE_DATABASE_URL ?? "postgresql://agentbridge:agentbridge@localhost:5433/agentbridge";
