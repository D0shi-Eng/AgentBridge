/**
 * اختبارات حل مفاتيح التوقيع الثلاثة من الإعداد.
 * تثبت: تحميل سليم من PKCS8/SPKI، ورفض الصيغ الفاسدة برمي قبل الإقلاع،
 * وبناء حلقات التحقق (الدوران)، وحتمية سياسة سقف الحجز التقني.
 */

import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { ceilingUsdOfFactory, resolveSigningMaterials } from "./container/resolve-signing.js";
import { loadHitlSigningMaterial } from "./run-service/hitl-approval.js";
import { DEV_RETENTION_POLICY } from "@agentbridge/infra";
import type { AppConfig } from "@agentbridge/infra";

/** يولد مفتاح Ed25519 ويعيد بترميزات الإعداد الثلاثة */
function ed25519Material() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    pkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    spki: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

/** إعداد أدنى صالح — يُعدّل في كل حالة */
function baseConfig(overrides: Partial<AppConfig>): AppConfig {
  return {
    nodeEnv: "test",
    port: 3000,
    logLevel: "info",
    databaseUrl: "postgresql://localhost/test",
    redisUrl: "redis://localhost:6379",
    encryptionKey: Buffer.alloc(32, 7),
    llmProvider: "mock",
    anthropicApiKey: "",
    openaiApiKey: "",
    llmMonthlyBudgetUsd: 10,
    persistence: "memory",
    appOrigin: "http://127.0.0.1:3001",
    oidcRedirectUri: "http://127.0.0.1:3000/auth/oidc/callback",
    stagingHttps: false,
    liveProbesEnabled: false,
    localBootstrapEnabled: false,
    sandboxProbesEnabled: false,
    orchSnapshotVerifyPublicKeys: [],
    certSigningVerifyPublicKeys: [],
    certSigningRevokedKeyIds: [],
    kmsProvider: "local",
    retentionPolicy: DEV_RETENTION_POLICY,
    llmReservationCeilingFactor: 2,
    llmReservationPriceUsdPer1kChars: 0.002,
    llmReservationMinUsd: 0.01,
    ...overrides,
  };
}

describe("resolveSigningMaterials", () => {
  it("يحمل الثلاثية من الإعداد ويبني حلقة التحقق بمفاتيح الدوران", () => {
    const snapshot = ed25519Material();
    const previous = ed25519Material();
    const cert = ed25519Material();
    const hitl = ed25519Material();
    const resolved = resolveSigningMaterials(baseConfig({
      orchSnapshotPrivateKey: snapshot.pkcs8,
      orchSnapshotVerifyPublicKeys: [previous.spki],
      certSigningPrivateKey: cert.pkcs8,
      hitlSigningPrivateKey: hitl.pkcs8,
    }));
    expect(resolved.snapshot).toBeDefined();
    expect(resolved.certificate).toBeDefined();
    expect(resolved.hitl).toBeDefined();
    // حلقة التحقق تحوي القديم + الحالي (الإعداد الحالي يدخلها من الحاوية)
    expect(resolved.snapshotVerifyKeys.size).toBe(1);
    expect([...resolved.snapshotVerifyKeys.keys()][0]).not.toBe(resolved.snapshot?.keyId);
  });

  it("مفتاح فاسد يرمي قبل الإقلاع — لا مفتاح بديل صامت", () => {
    // "not-base64-pkcs8" يمر فلتر base64 لconfig لكنه ليس PKCS8 صالحاً
    expect(() => resolveSigningMaterials(baseConfig({ orchSnapshotPrivateKey: "!!!!not-base64!!!!" }))).toThrow();
    expect(() => resolveSigningMaterials(baseConfig({ certSigningPrivateKey: "AAAA" }))).toThrow();
    expect(() => resolveSigningMaterials(baseConfig({ hitlSigningPrivateKey: "AAAA" }))).toThrow();
    expect(() => resolveSigningMaterials(baseConfig({ orchSnapshotVerifyPublicKeys: ["AAAA"] }))).toThrow();
  });

  it("غياب الإعداد كلياً يعود بحلقة فارغة ومواد غائبة — سلوك التطوير الموثق", () => {
    const resolved = resolveSigningMaterials(baseConfig({}));
    expect(resolved.snapshot).toBeUndefined();
    expect(resolved.certificate).toBeUndefined();
    expect(resolved.hitl).toBeUndefined();
    expect(resolved.snapshotVerifyKeys.size).toBe(0);
  });
});

describe("محمل مفتاح HITL", () => {
  it("يرفض غير Ed25519 وغير الصيغة الصالحة", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rsaPkcs8 = rsa.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    expect(loadHitlSigningMaterial(rsaPkcs8).ok).toBe(false);
    expect(loadHitlSigningMaterial("AAAA").ok).toBe(false);
  });
});

describe("سياسة سقف الحجز التقني (حتمية)", () => {
  const config = baseConfig({});
  const ceilingOf = ceilingUsdOfFactory(config);

  it("نفس الطلب يعطي نفس السقف دائماً — لا عشوائية في الحجز", () => {
    const request = { system: "sys", messages: [{ role: "user" as const, content: "hello world" }] };
    const a = ceilingOf(request as never);
    const b = ceilingOf(request as never);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });

  it("الحد الأدنى يحمي من سقف صفري والنمو خطي بالأحرف", () => {
    const tiny = ceilingOf({ system: "", messages: [] } as never);
    expect(tiny).toBeGreaterThanOrEqual(config.llmReservationMinUsd);
    const small = ceilingOf({ system: "x".repeat(1000), messages: [] } as never);
    const big = ceilingOf({ system: "x".repeat(10_000), messages: [] } as never);
    expect(big).toBeGreaterThan(small);
    // 10k حرف × 0.002$/1k × 2 معامل = 0.04$ بالضبط (حتمية الصيغة المعلنة)
    expect(big).toBeCloseTo(0.04, 6);
  });
});
