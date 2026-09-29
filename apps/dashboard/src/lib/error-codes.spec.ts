/**
 * اختبارات عقد ترجمة الأكواد — كل كود معروف له ترجمة
 * باللغتين، وغير المعروف يقع على رسالة عامة آمنة، ولا تُعرض رسائل
 * الخادم الخام إطلاقاً.
 */

import { describe, expect, it } from "vitest";
import { errorKeyForCode } from "./error-codes.js";
import { apiErrorMessage, certDeniedReasonText } from "./i18n.js";
import { ApiError } from "./api-client.js";
import { ar } from "./i18n/ar.js";
import { en } from "./i18n/en.js";

describe("errorKeyForCode", () => {
  it("الأكواد المعروفة لها مفاتيح", () => {
    expect(errorKeyForCode("UNAUTHORIZED")).toBe("error.sessionExpired");
    expect(errorKeyForCode("FORBIDDEN")).toBe("error.forbidden");
    expect(errorKeyForCode("NOT_FOUND")).toBe("error.notFound");
    expect(errorKeyForCode("SSO_UPSTREAM_FAILED")).toBe("error.ssoUpstreamFailed");
  });

  it("كود غير معروف يعيد undefined — المستدعي يسقط على العام", () => {
    expect(errorKeyForCode("SOME_FUTURE_CODE")).toBeUndefined();
  });
});

describe("apiErrorMessage — لا رسالة خام من الخادم", () => {
  it("كود معروف يُترجم باللغة المطلوبة", () => {
    const err = new ApiError(403, "FORBIDDEN", "رسالة عربية خام لا تُعرض");
    expect(apiErrorMessage(err, "ar", "error.generic")).toBe(ar["error.forbidden"]);
    expect(apiErrorMessage(err, "en", "error.generic")).toBe(en["error.forbidden"]);
  });

  it("كود غير معروف يعرض الرسالة العامة مع الكود التقني وحده", () => {
    const err = new ApiError(500, "MYSTERY_CODE", "raw server text");
    const message = apiErrorMessage(err, "en", "error.generic");
    expect(message).toContain("MYSTERY_CODE");
    expect(message).not.toContain("raw server text");
  });

  it("رسالة الخادم الخام لا تُعرض حتى لو كانت نصها غير فارغ", () => {
    const err = new ApiError(400, "INVALID_INPUT", "رسالة التحقق الخام من الخادم");
    expect(apiErrorMessage(err, "en", "error.generic")).not.toContain("رسالة التحقق");
  });
});

describe("certDeniedReasonText — ترجمة رمز السبب", () => {
  it("الرموز المعروفة تترجم باللغتين", () => {
    expect(certDeniedReasonText("LIVE_EVIDENCE_MISSING", "ar")).toBe(
      ar["run.certDeniedCode.LIVE_EVIDENCE_MISSING"],
    );
    expect(certDeniedReasonText("LIVE_EVIDENCE_MISSING", "en")).toBe(
      en["run.certDeniedCode.LIVE_EVIDENCE_MISSING"],
    );
  });

  it("رمز مفقود أو مجهول يعود للرسالة الموحدة الآمنة", () => {
    expect(certDeniedReasonText(undefined, "ar")).toBe(ar["run.certDeniedCode.UNKNOWN"]);
    expect(certDeniedReasonText("NEWER_CODE", "ar")).toBe(ar["run.certDeniedCode.UNKNOWN"]);
  });
});
