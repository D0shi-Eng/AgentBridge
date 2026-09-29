/**
 * مسار التحقق العام — الوجه العلني لقرار الشهادة.
 *
 * GET /verify/:verificationId بلا مصادقة: أي زائر يحمل شارة عميل
 * يفتح رابطها فيرى القرار موثقاً. الرد قائمة بيضاء صارمة من حقول
 * الشهادة العامة — لا معرف مستأجر ولا تشغيل ولا أي بيانات حساسة.
 * رقم غير معروف أو بصيغة خاطئة = 404 واحد بلا تمييز بين الحالتين.
 *
 * عند وجود شهادة موقعة يتحقق المسار توقيعها بمفاتيح
 * الإعداد — توقيع غير سليم/منتهٍ/مبطّل = نتيجة invalid موثقة بالسبب
 * (لا عرض بيانات موقعة زوراً). الشهادات غير الموقعة (تطوير بلا مفتاح)
 * تبقى معروضة بلا claim توقيع — الفرق معلن في الرد.
 */

import type { FastifyInstance } from "fastify";
import { AppError } from "@agentbridge/shared";
import type { Certificate } from "@agentbridge/shared";
import { verifyCertificate, type VerificationOutcome } from "@agentbridge/evaluator";
import type { ApiContainer } from "../container.js";

/** صيغة رقم التحقق المعتمدة AB-<16 hex> — نفسها التي يبنيها مُنحِم الشهادات */
const VERIFICATION_ID_PATTERN = /^AB-[0-9a-f]{16}$/;

/** يفك JSON الشهادة من السجل — تالف يعامل 404 موحداً بلا تسريب */
function parseCertificate(certificateJson: string): Certificate | null {
  try {
    const parsed: unknown = JSON.parse(certificateJson);
      // كفاية أنه كائن JSON — فحص artifactsHash في المسار تحت
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Certificate;
    }
    return null;
  } catch {
    return null;
  }
}

export function registerVerifyRoutes(app: FastifyInstance, container: ApiContainer): void {
  app.get("/verify/:verificationId", { config: { auth: "public" } }, async (request) => {
    const { verificationId } = request.params as { verificationId: string };
    if (!VERIFICATION_ID_PATTERN.test(verificationId)) {
      throw new AppError("NOT_FOUND", "لا يوجد سجل تحقق بهذا الرقم");
    }
    const record = await container.semantic.getCertificateByVerificationId(verificationId);
    if (record === null) {
      throw new AppError("NOT_FOUND", "لا يوجد سجل تحقق بهذا الرقم");
    }
    const certificate = parseCertificate(record.certificateJson);
    if (certificate === null) {
      // تلف داخلي بين السجل ونص الشهادة — 404 موحد بلا تفاصيل داخلية
      throw new AppError("NOT_FOUND", "لا يوجد سجل تحقق بهذا الرقم");
    }

    // التحقق التوقيعي عند وجود كتلة توقيع — فشله يظهر invalid بالسبب
    // الإبطال موصول فعلياً — صف revocation (تخزين دائم) أو
    // keyId ملغى من إعداد الخادم يجعل السبب "revoked" موثقاً لا رفضاً مجهولاً
    let signature: VerificationOutcome | null = null;
    if (certificate.signature !== undefined) {
      const publicKey = container.certificateKeys.get(certificate.signature.keyId);
      if (publicKey === undefined) {
        signature = { valid: false, reason: "malformed" };
      } else {
        const revocation = await container.semantic.getRevocationByVerificationId(verificationId);
        signature = verifyCertificate(certificate, {
          publicKey,
          ...(revocation !== null ? { revokedVerificationIds: [verificationId] } : {}),
          ...(container.certificateRevokedKeyIds.length > 0 ? { revokedKeyIds: [...container.certificateRevokedKeyIds] } : {}),
        });
      }
    }

    // القائمة البيضاء حصراً — ما لا يُدرج هنا لا يغادر الخادم أبداً.
    // لا runId/tenantId رغم حضورهما في runBinding — الواجهة العامة فقط
    // revoked علم صريح حتى للشهادات غير الموقعة (تطوير)
    const revocation = await container.semantic.getRevocationByVerificationId(verificationId);
    return {
      verificationId: record.verificationId,
      finalScore: record.finalScore,
      granted: record.granted,
      issuedAt: record.issuedAt,
      artifactsHash: certificate.artifactsHash,
      revoked: revocation !== null,
      signature: signature === null
        ? { present: false as const }
        : { present: true as const, valid: signature.valid, ...(signature.reason !== undefined ? { reason: signature.reason } : {}) },
    };
  });
}
