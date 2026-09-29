/**
 * عقد ترجمة أكواد أخطاء الخادم  — لا نص خام يُعرض للمستخدم.
 *
 * المبدأ : الخادم يعيد `code` ثابتاً، والواجهة تترجمه
 * حسب اللغة — لا تُبنَ الترجمة على مطابقة نص الرسالة، ولا يُعرض النص
 * الخام القادم من الخادم إطلاقاً؛ الرسائل الداخلية تبقى في سجلات الخادم.
 * أي كود غير معروف يقع على fallback آمن مترجم مع إظهار الكود التقني
 * وحده (معرف ثابت لا يكشف تفاصيل داخلية).
 */

import type { UiKey } from "./i18n";

/** خريطة أكواد الخادم المعروفة → مفتاح ترجمة */
const CODE_KEYS: Readonly<Record<string, UiKey>> = {
  UNAUTHORIZED: "error.sessionExpired",
  SESSION_EXPIRED: "error.sessionExpired",
  FORBIDDEN: "error.forbidden",
  NOT_FOUND: "error.notFound",
  INTERNAL: "error.internal",
  INVALID_INPUT: "error.validation",
  SPEC_TOO_LARGE: "error.specTooLarge",
  CSRF_REJECTED: "error.csrfRejected",
  ORIGIN_REJECTED: "error.originRejected",
  APPROVAL_REQUIRED: "error.approvalRequired",
  ARTIFACT_NOT_CERTIFIED: "error.artifactNotCertified",
  // الشهادة الملغاة لا تسلّم مخرجاتها ولا تُبطأ مرتين
  ARTIFACT_REVOKED: "error.artifactRevoked",
  CERT_ALREADY_REVOKED: "error.artifactRevoked",
  RUN_ALREADY_ACTIVE: "error.runAlreadyActive",
  TOO_MANY_ACTIVE_RUNS: "error.tooManyActiveRuns",
  NO_SNAPSHOT: "error.noSnapshot",
  SSO_CONFIG_CONFLICT: "error.ssoConfigConflict",
  SSO_UNAVAILABLE: "error.ssoUnavailable",
  SSO_UPSTREAM_FAILED: "error.ssoUpstreamFailed",
  RATE_LIMITED: "error.rateLimited",
  SSE_QUOTA_EXCEEDED: "error.rateLimited",
  SSE_QUOTA_STORE_DOWN: "error.network",
};

/**
 * يعيد مفتاح الترجمة لكود الخادم، أو undefined لكود غير معروف
 * — والمستدعي يستخدم fallback المترجم العام.
 */
export function errorKeyForCode(code: string): UiKey | undefined {
  return CODE_KEYS[code];
}
