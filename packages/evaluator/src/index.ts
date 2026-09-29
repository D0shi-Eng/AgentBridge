/**
 * المنفذ العام لحزمة evaluator:
 *   الشهادة: certifyArtifacts() + بوابة الرفض الحرجة + البصمة + الشارة.
 *   الموثق:  verifyCitations() بوابة حتمية ضد الهلوسة.
 */

export {
  CERTIFICATION_THRESHOLD,
  certifyArtifacts,
  computeArtifactsHash,
  type CertificationInput,
} from "./certificate.js";
export {
  CERTIFICATE_POLICY_VERSION,
  CERTIFICATE_TTL_DAYS,
  generateSigningKeyMaterial,
  loadSigningKeyMaterial,
  signCertificate,
  verifyCertificate,
  type SigningKeyMaterial,
  type SignOptions,
  type VerificationOutcome,
} from "./certificate-signing.js";
export { renderBadge } from "./badge.js";
export {
  verifyCitations,
  type CitationReport,
  type CitationViolation,
} from "./citation-verifier.js";
export { CertErrors } from "./errors.js";
