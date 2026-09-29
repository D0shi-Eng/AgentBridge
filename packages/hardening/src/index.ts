/**
 * المنفذ العام لحزمة hardening — عقد النظام الرابع تجاه المنسق (وثيقة 03 §4).
 *
 * مساران فقط:
 *   1. runStaticChecks(): عشر فحوص حتمية على نص الـartifact — بلا عملية ولا شبكة.
 *   2. runLiveProbes(): أربعة اختراقات على خادم حي فوق upstream محلي مسجل.
 *
 * والتجميع: buildSecurityReport يحول النتائج إلى SecurityReport جاهز للشهادة.
 */

export { runStaticChecks } from "./security-tests.js";
export {
  runLiveProbes,
  type LiveProbeOptions,
  type ProbeTarget,
} from "./live-probes.js";
export {
  buildSecurityReport,
  computeCleanlinessScore,
  type SecurityCheckCategory,
  type SecurityCheckResult,
} from "./report.js";
export {
  ALLOWED_ENV_KEYS,
  collectEnvKeys,
  scanContents,
  CODE_EXEC_PATTERNS,
  DYNAMIC_IMPORT_PATTERN,
  INJECTION_PATTERNS,
  RAW_NETWORK_PATTERNS,
  SECRET_PATTERNS,
  SHELL_FS_PATTERNS,
  type PatternHit,
} from "./injection-guards.js";
export {
  checkEnvContract,
  checkErrorSanitization,
  checkManifestIntegrity,
  checkToolSchemas,
  extractManifestToolNames,
  extractRegisteredToolNames,
  parseManifest,
  type StructuralCheck,
} from "./scope-checker.js";
export { LEAK_MARKER, TRAVERSAL_MARKER, startRecordingUpstream } from "./mock-upstream.js";
export { checkAstBoundaries } from "./ast-scope-checker.js";
export { SecurityCheckResultSchema } from "./report.js";
// MockOidcProvider واجهة نوع فقط — تصديرها القيمي يُسقط محمّل ESM الحقيقي
// (tsx/Node) بـSyntaxError رغم تسامح vitest معها — عيب كامن كشفه تشغيل
// رحلة المتصفح (AB-B05)؛ التصدير النوعي هو الصحيح بنيوياً.
export type { MockOidcProvider } from "./mock-oidc-provider.js";
export { startMockOidcProvider } from "./mock-oidc-provider.js";
export { HardErrors } from "./errors.js";
