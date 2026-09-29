/**
 * وحدة التشفير — كلها node:crypto بلا تبعية خارجية (ADR-12):
 *   1. AES-256-GCM لتشفير أسرار العملاء at-rest (وثيقة security.md §2)
 *      بصيغة مغلف `v1.iv.tag.ciphertext` بترميز base64.
 *   2. scrypt (KDF صلب ذاكرةً مدمج في Node) لتجزئة مفاتيح API —
 *      لا استرجاع ممكن، تحقق بزمن ثابت.
 *   3. أدوات الهاش: sha256Hex وstableStringify لسلسلة التدقيق
 *      وأي بصمة حتمية تحتاج ترتيب مفاتيع مثبتاً.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { AppError, err, ok, type Result } from "@agentbridge/shared";

export const CryptoErrors = {
  decryptFailed: () =>
    new AppError("CRYPTO_DECRYPT_FAILED", "فشل فك تشفير السر — البيانات مفسدة أو المفتاح مخالف", false, "critical"),
  malformedEnvelope: () =>
    new AppError("CRYPTO_MALFORMED_ENVELOPE", "مغلف السر ليس بالصيغة الموثقة v1.iv.tag.ciphertext", false, "warning"),
  malformedKeyHash: () =>
    new AppError("CRYPTO_MALFORMED_KEY_HASH", "hash مفتاح API ليس بالصيغة الموثقة scrypt$N$r$p$salt$digest", false, "warning"),
} as const;

const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;

/** هاش SHA-256 سداسي عشري لنص حر */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** JSON حتمي: مفاتيح الكائنات مرتبة والترتيب داخل المصفوفات محفوظ */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

/** يشفر سراً بمفتاح 32 بايت ويعيد المغلف النصي الجاهز للتخزين */
export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [ENVELOPE_VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}

/** يفك المغلف — أي عبث بايت واحد يكسر وسم GCM فيرفض */
export function decryptSecret(key: Buffer, envelope: string): Result<string> {
  const parts = envelope.split(".");
  if (parts.length !== 4 || (parts[0] ?? "") !== ENVELOPE_VERSION) {
    return err(CryptoErrors.malformedEnvelope());
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1] ?? "", "base64"));
    decipher.setAuthTag(Buffer.from(parts[2] ?? "", "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parts[3] ?? "", "base64")),
      decipher.final(),
    ]).toString("utf8");
    return ok(plaintext);
  } catch {
    return err(CryptoErrors.decryptFailed());
  }
}

/* ---------- تجزئة مفاتيح API بscrypt (ADR-12) ----------
 * نسخ غير حاجبة (Promise) لمسار طلبات HTTP — scryptSync
 * يحجز حلقة الأحداث لكل تحقق فيؤخر الطلبات المتداخلة. الحدود:
 * مدخل خام أقصاه 512 محرفاً (مفاتيحنا الفعلية ~40)، ومعاملات المخزن
 * مثبتة بحدود علوية — صف مخزن متلاعب به لا يستطيع استنزاف CPU بـN ضخم. */

export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

/** حدود المدخلات والمعاملات لمنع استنزاف الموارد */
export const MAX_API_KEY_INPUT_CHARS = 512;
const SCRYPT_MAX_N = 4 * 1024 * 1024;
const SCRYPT_MAX_R = 64;

/** يثبت معاملات مخزن ضمن الحدود — قيمة شاذة ترفض بلا تنفيذ */
function clampStoredScryptParams(nStr: string, rStr: string, pStr: string): { N: number; r: number; p: number } | null {
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N < 16384 || N > SCRYPT_MAX_N || r < 8 || r > SCRYPT_MAX_R || p < 1 || p > 8) return null;
  return { N, r, p };
}

/** غلاف Promise فوق scrypt — لا يحجز حلقة الأحداث أثناء الاشتقاق */
const scryptAsync = (secret: string | Buffer, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(secret, salt, keylen, options, (error, derived) => (error !== null ? reject(error) : resolve(derived)));
  });

/** يولد مفتاح API خام جديداً بصيغة `ab_<base64url>` — يُعرض مرة واحدة */
export function generateApiKey(): string {
  return `ab_${randomBytes(24).toString("base64url")}`;
}

/** hash scrypt بصيغة ذاتية الوصف تحمل معاملاتها للتحقق لاحقاً */
export function hashApiKey(rawKey: string): string {
  const salt = randomBytes(SCRYPT_PARAMS.keylen);
  const digest = scryptSync(rawKey, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return [
    "scrypt",
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString("base64"),
    digest.toString("base64"),
  ].join("$");
}

/** تحقق بزمن شبه ثابت — لا يكشف طول المخزن ولا موقع أول اختلاف */
export function verifyApiKey(rawKey: string, storedHash: string): boolean {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || (parts[0] ?? "") !== "scrypt") return false;
  try {
    const expected = Buffer.from(parts[5] ?? "", "base64");
    const actual = scryptSync(rawKey, Buffer.from(parts[4] ?? "", "base64"), expected.length, {
      N: Number(parts[1]),
      r: Number(parts[2]),
      p: Number(parts[3]),
    });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** hash scrypt غير حاجب — نفس الصيغة الذاتية الوصف تماماً */
export async function hashApiKeyAsync(rawKey: string): Promise<string> {
  if (rawKey.length > MAX_API_KEY_INPUT_CHARS) {
    throw new Error("SCRYPT_INPUT_TOO_LONG: مدخل مفتاح API يتجاوز الحد");
  }
  const salt = randomBytes(SCRYPT_PARAMS.keylen);
  const digest = await scryptAsync(rawKey, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return ["scrypt", SCRYPT_PARAMS.N, SCRYPT_PARAMS.r, SCRYPT_PARAMS.p, salt.toString("base64"), digest.toString("base64")].join("$");
}

/** تحقق غير حاجب بزمن شبه ثابت — معاملات المخزن مثبتة بالحدود قبل التنفيذ */
export async function verifyApiKeyAsync(rawKey: string, storedHash: string): Promise<boolean> {
  if (rawKey.length > MAX_API_KEY_INPUT_CHARS) return false;
  const parts = storedHash.split("$");
  if (parts.length !== 6 || (parts[0] ?? "") !== "scrypt") return false;
  const params = clampStoredScryptParams(parts[1] ?? "", parts[2] ?? "", parts[3] ?? "");
  if (params === null) return false;
  try {
    const expected = Buffer.from(parts[5] ?? "", "base64");
    if (expected.length !== SCRYPT_PARAMS.keylen) return false;
    const actual = await scryptAsync(rawKey, Buffer.from(parts[4] ?? "", "base64"), expected.length, params);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** معرف تشغيل فريد — uuid إصدار 4 من node:crypto */
export function newRunId(): string {
  return randomUUID();
}
