/**
 * مرساة رأس سلسلة التدقيق — checkpoint موقّع خارج نطاق التعديل.
 *
 * ماهيتها: توقيع Ed25519 على رأس السلسلة (tenantId/seq/hash) بمفتاح
 * يُحفظ **خارج قاعدة البيانات** — من يسيطر على القاعدة يستطيع إعادة
 * كتابة السلسلة وحذف المرساة المخزنة فيها، لكنه لا يستطيع توليد توقيع
 * مرساة جديدة بمفتاح الخادم.
 * مستوى التحقيق (بصدق لا تضخيم): تكشف إعادة الكتابة/القص/إعادة الترتيب
 * لسلسلة كاملة إذا كانت آخر مرساة موقعة محفوظة لدى المشغّل — ولا تدّعي
 * tamper-proof: مَن يملك الخادم كاملاً (المفتاح + القاعدة معاً) يتجاوزها.
 * الدورية: عملية تشغيلية خارجية (سكربت توقيع المرساة) توقّع
 * الرأس دورياً وتحفظ الناتج في وسيط المشغّل.
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { AppError, err, ok, type Result } from "@agentbridge/shared";

/**
 * مُسلسل حتمي محلي — مفاتيح مرتبة معجمياً تكرارياً بلا فراغات. نسخة مصغرة
 * مقصودة من canonicalJson (orchestrator) ليبقى infra بلا اعتماد علوي —
 * العقد نفسه: التوقيع حتمي عبر المنصات.
 */
function canonicalJsonLocal(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJsonLocal).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJsonLocal(v)}`).join(",")}}`;
}

/** مرساة رأس سلسلة — مدخل التوقيع والتحقق */
export interface AuditCheckpoint {
  readonly tenantId: string;
  readonly seq: number;
  /** hash رأس السلسلة عند لحظة التوقيع */
  readonly headHash: string;
  readonly at: string;
}

export interface AuditCheckpointMaterial {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly keyId: string;
}

export interface SignedAuditCheckpoint {
  readonly checkpoint: AuditCheckpoint;
  readonly auth: { readonly alg: "Ed25519"; readonly keyId: string; readonly value: string };
}

export function generateCheckpointMaterial(): AuditCheckpointMaterial {
  const { privateKey, publicKey } = createKeyPair();
  return materialOf(privateKey, publicKey);
}

/** يحمل المرساة من إعداد الخادم (PKCS8 base64) — يرمي على غير الصالح */
export function loadCheckpointMaterial(privatePkcs8Base64: string): Result<AuditCheckpointMaterial> {
  try {
    const privateKey = createPrivateKey({ key: Buffer.from(privatePkcs8Base64, "base64"), format: "der", type: "pkcs8" });
    if (privateKey.asymmetricKeyType !== "ed25519") {
      return err(new AppError("AUDIT_CHECKPOINT_KEY_INVALID", "مفتاح مرساة التدقيق يجب أن يكون Ed25519", false, "critical"));
    }
    return ok(materialOf(privateKey, createPublicKey(privateKey)));
  } catch {
    return err(new AppError("AUDIT_CHECKPOINT_KEY_INVALID", "تعذر تحميل مفتاح مرساة التدقيق — PKCS8 base64 لـEd25519 مطلوب", false, "critical"));
  }
}

function createKeyPair() {
  return generateKeyPairSync("ed25519");
}

function materialOf(privateKey: KeyObject, publicKey: KeyObject): AuditCheckpointMaterial {
  const keyId = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex").slice(0, 16);
  return { privateKey, publicKey, keyId };
}

/** يوقّع رأس السلسلة الحالي — تُستدعى دورياً من العملية التشغيلية */
export function signCheckpoint(
  checkpoint: AuditCheckpoint,
  material: AuditCheckpointMaterial,
): SignedAuditCheckpoint {
  const value = sign(null, Buffer.from(canonicalJsonLocal(checkpoint), "utf8"), material.privateKey);
  return {
    checkpoint,
    auth: { alg: "Ed25519", keyId: material.keyId, value: value.toString("base64") },
  };
}

/**
 * يتحقق أن رأس السلسلة الحالي في القاعدة يطابق آخر مرساة موقعة لدى
 * المشغّل — أي قص/إعادة كتابة/إعادة ترتيب بعد لحظة التوقيع يكشف هنا.
 */
export function verifyCheckpoint(
  signedCheckpoint: SignedAuditCheckpoint,
  options: { readonly publicKey: KeyObject; readonly currentHead: AuditCheckpoint },
): Result<{ readonly matchesHead: boolean }> {
  const signatureOk = verify(
    null,
    Buffer.from(canonicalJsonLocal(signedCheckpoint.checkpoint), "utf8"),
    options.publicKey,
    Buffer.from(signedCheckpoint.auth.value, "base64"),
  );
  if (!signatureOk) {
    return err(new AppError("AUDIT_CHECKPOINT_BAD_SIGNATURE", "توقيع مرساة التدقيق لا يطابق محتواها", false, "critical"));
  }
  const c = signedCheckpoint.checkpoint;
  const matchesHead =
    c.tenantId === options.currentHead.tenantId &&
    c.seq === options.currentHead.seq &&
    c.headHash === options.currentHead.headHash;
  return ok({ matchesHead });
}
