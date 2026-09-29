/**
 * قالب config.ts — قراءة إعدادات التشغيل من البيئة بفشل إقلاع صريح.
 * UPSTREAM_BASE_URL إلزامي: خادم بلا هدف upstream لا معنى لإقلاعه.
 */

export interface ConfigTemplateInput {
  readonly serverName: string;
}

export function renderConfigModule(_input: ConfigTemplateInput): string {
  return `/**
 * إعدادات تشغيل الخادم المولد.
 * يقرأ البيئة عند الإقلاع ويفشل فوراً برسالة عربية إن نقص الإلزامي.
 */

/** إعدادات الخادم بعد التحقق */
export interface ServerConfig {
  /** عنوان الـAPI الأصلي الذي تناديه الأدوات */
  readonly upstreamBaseUrl: string;
  /** مفتاح حامل اختياري يمرر كما هو إن وُجد */
  readonly upstreamApiKey?: string;
}

/** يبني الإعدادات من بيئة العملية — يستدعى مرة واحدة عند الإقلاع */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const baseUrl = env["UPSTREAM_BASE_URL"];
  if (baseUrl === undefined || baseUrl.trim() === "") {
    throw new Error(
      "متغير البيئة UPSTREAM_BASE_URL مفقود — حدّد عنوان الـAPI الأصلي ثم أعد الإقلاع",
    );
  }
  // نزيل الشرطة المائلة الأخيرة لتوحيد بناء المسارات
  const apiKey = env["UPSTREAM_API_KEY"];
  return {
    upstreamBaseUrl: baseUrl.replace(/\\/+$/u, ""),
    ...(apiKey !== undefined && apiKey !== "" ? { upstreamApiKey: apiKey } : {}),
  };
}
`;
}
