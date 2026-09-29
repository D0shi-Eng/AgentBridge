/**
 * اختبارات crypto — AES-256-GCM وscrypt والهاش الحتمي.
 */
import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  CryptoErrors,
  decryptSecret,
  encryptSecret,
  generateApiKey,
  hashApiKey,
  newRunId,
  sha256Hex,
  stableStringify,
  verifyApiKey,
} from "./crypto.js";

const KEY = randomBytes(32);

describe("AES-256-GCM", () => {
  it("دورة تشفير وفك كاملة تعيد النص الأصلي", () => {
    const secret = "UPSTREAM_TOKEN=حساس-جداً-123";
    const envelope = encryptSecret(KEY, secret);
    expect(envelope.startsWith("v1.")).toBe(true);

    const result = decryptSecret(KEY, envelope);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(secret);
  });

  it("عبث بايت واحد في النص المشفر يكسر الفك برسالة عربية", () => {
    const envelope = encryptSecret(KEY, "secret-value");
    const parts = envelope.split(".");
    const ciphertext = Buffer.from(parts[3] ?? "", "base64");
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], ciphertext.toString("base64")].join(".");

    const result = decryptSecret(KEY, tampered);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(CryptoErrors.decryptFailed().code);
    expect(result.error.message).toContain("فشل فك تشفير");
  });

  it("مغلف بصيغة خاطئة يرفض قبل أي فك، ومفتاح مخالف يعطي نفس المصير", () => {
    const malformed = decryptSecret(KEY, "not-an-envelope");
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.code).toBe(CryptoErrors.malformedEnvelope().code);

    const wrongKey = decryptSecret(randomBytes(32), encryptSecret(KEY, "x"));
    expect(wrongKey.ok).toBe(false);
  });

  it("نفس السر يعطي مغلفين مختلفين (iv عشوائي) كلاهما صحيح", () => {
    const first = encryptSecret(KEY, "same");
    const second = encryptSecret(KEY, "same");
    expect(first).not.toBe(second);
    expect(decryptSecret(KEY, first).ok).toBe(true);
    expect(decryptSecret(KEY, second).ok).toBe(true);
  });
});

describe("scrypt لمفاتيح API", () => {
  it("hash لنفس المفتاح يختلف بالملح لكن التحقق ينجح دائماً", () => {
    const raw = generateApiKey();
    expect(raw.startsWith("ab_")).toBe(true);

    const first = hashApiKey(raw);
    const second = hashApiKey(raw);
    expect(first).not.toBe(second);
    expect(verifyApiKey(raw, first)).toBe(true);
    expect(verifyApiKey(raw, second)).toBe(true);
  });

  it("مفتاح خاطئ يفشل، وصيغة فاسدة تفشل دون استثناء", () => {
    const stored = hashApiKey(generateApiKey());
    expect(verifyApiKey("ab_wrong-key-value", stored)).toBe(false);
    expect(verifyApiKey("anything", "garbage")).toBe(false);
    expect(verifyApiKey("anything", "md5$abc$def")).toBe(false);
  });

  it("المفتاح الخام لا يظهر في الـhash إطلاقاً (لا استرجاع ممكن)", () => {
    const raw = "ab_supersensitive-secret-token";
    expect(hashApiKey(raw)).not.toContain(raw.slice(3));
  });
});

describe("الهاش الحتمي", () => {
  it("sha256Hex معروف الطول وسلوكه ثابت", () => {
    expect(sha256Hex("abc")).toHaveLength(64);
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"));
  });

  it("stableStringify يرتب المفاتيح ويحفظ ترتيب المصفوفات ويسقط undefined", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableStringify([2, 1])).toBe("[2,1]");
    expect(stableStringify({ x: undefined, y: null })).toBe('{"y":null}');
    expect(stableStringify({ d: { c: 1, b: [3, { f: 2, e: 1 }] } })).toBe(
      '{"d":{"b":[3,{"e":1,"f":2}],"c":1}}',
    );
  });
});

describe("newRunId", () => {
  it("معرفات فريدة غير فارغة", () => {
    expect(newRunId()).not.toBe(newRunId());
    expect(newRunId().length).toBeGreaterThan(10);
  });
});
