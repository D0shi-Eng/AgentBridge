/**
 * المصدر الوحيد لعنوان قاعدة التطوير الحية في الاختبارات (قاعدة ملزمة:
 * لا hardcode لـlocalhost ولا connection strings ثابتة موزعة).
 * البيئة أولاً (AB_LIVE_DATABASE_URL) ثم العنوان الموثق في docker-compose.dev.yaml
 * — اعتماد تطوير معلن في ملف compose نفسه، ليس سراً إنتاجياً.
 */
export const LIVE_DATABASE_URL =
  process.env.AB_LIVE_DATABASE_URL ?? "postgresql://agentbridge:agentbridge@localhost:5433/agentbridge";
