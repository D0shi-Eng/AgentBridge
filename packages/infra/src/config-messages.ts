/**
 * رسائل الرفض العربية المحددة لكل حقل إعداد — فصل الرسائل عن منطق
 * التحقق (config.ts) بلا تغيير في أي سلوك.
 */

/** رسالة عربية محددة لكل حقل مرفوض — بدل رسائل Zod الإنجليزية الخام */
export function arabicIssue(path: string): string {
  switch (path) {
    case "JWKS_ALLOWED_HOSTS":
      return "قائمة مضيفي JWKS غير صالحة — Invalid JWKS host allowlist";
    case "ENCRYPTION_KEY":
      return "ENCRYPTION_KEY مفقود أو ليس base64 صالحاً — ولّد مفتاحاً بـ32 بايت ثم رمّزه base64";
    case "DATABASE_URL":
      return "DATABASE_URL مفقود — عنوان PostgreSQL إلزامي حتى في التطوير";
    case "REDIS_URL":
      return "REDIS_URL مفقود — عنوان Redis إلزامي للذاكرة العرضية";
    case "PORT":
      return "PORT يجب أن يكون عدداً صحيحاً بين 1 و65535";
    case "LLM_MONTHLY_BUDGET_USD":
      return "LLM_MONTHLY_BUDGET_USD يجب أن يكون عدداً موجباً بالدولار";
    case "NODE_ENV":
      return "NODE_ENV يقبل development|test|production فقط";
    case "LOG_LEVEL":
      return "LOG_LEVEL يقبل debug|info|warn|error فقط";
    case "LLM_PROVIDER":
      return "LLM_PROVIDER يقبل anthropic|openai|mock فقط";
    case "PERSISTENCE":
      return "PERSISTENCE يقبل memory|live فقط — live يستلزم PostgreSQL وRedis حيّين";
    case "AGENTBRIDGE_LIVE_PROBES":
      return "AGENTBRIDGE_LIVE_PROBES يقبل 0|1 فقط — تفعيل الفئات الحية قرار خادم موثوق";
    case "AGENTBRIDGE_SANDBOX_PROBES":
      return "AGENTBRIDGE_SANDBOX_PROBES يقبل 0|1 فقط — عزل الفحص الحي في الحاوية قرار خادم موثوق";
    case "LOCAL_BOOTSTRAP":
      return "LOCAL_BOOTSTRAP يقبل 0|1 فقط - جلسة الوضع المحلي قرار خادم موثوق";
    case "LOCAL_TENANT_ID":
      return "LOCAL_TENANT_ID مفقود أو غير صالح - هوية مساحة العمل المحلية إلزامية عند التفعيل";
    case "LOCAL_CREDENTIAL_ID":
      return "LOCAL_CREDENTIAL_ID مفقود أو غير صالح - اعتماد مساحة العمل المحلية إلزامي عند التفعيل";
    default:
      return `${path} قيمة غير صالحة`;
  }
}
