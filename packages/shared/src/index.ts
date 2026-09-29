/**
 * نقطة التصدير الوحيدة لحزمة shared.
 *
 * القاعدة المعمارية: أي حزمة أخرى تستهلك shared عبر هذا الملف فقط،
 * فلا استيراد مباشر من ملفات داخلية — هذا يحمي حدود الوحدة.
 */

export * from "./types/result.js";
export * from "./types/pipeline.js";
export * from "./types/spec.js";
export * from "./types/artifacts.js";
export * from "./types/audit.js";
export * from "./errors/app-error.js";
export * from "./memory-keys.js";
export * from "./i18n.js";
export * from "./sso.js";
export * from "./identity.js";
