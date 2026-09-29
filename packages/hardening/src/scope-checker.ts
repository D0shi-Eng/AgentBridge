/**
 * مركز توافق فاحص الحدود البنيوية.
 *
 * التنفيذ مقسوم على ملفين ≤200: scope-checks.ts (المخططات/البيئة/manifest)
 * وscope-checks-hardening.ts (HB-11/HB-12/تعقيم الأخطاء). هذا الملف يعيد
 * تصدير العقد نفسه حرفياً — كل المستهلكين (index/security-tests/الاختبار)
 * يبقون على مسار ./scope-checker.js دون أي تغيير في الاستيراد أو السلوك.
 */

export {
  checkEnvContract,
  checkManifestIntegrity,
  checkToolSchemas,
  extractManifestToolNames,
  extractRegisteredToolNames,
  parseManifest,
} from "./scope-checks.js";
export type { StructuralCheck } from "./scope-checks.js";
export {
  checkErrorSanitization,
  checkJwksUrlHttps,
  checkJsonParseProtection,
  extractErrorReturnWindows,
} from "./scope-checks-hardening.js";
