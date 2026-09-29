/**
 * اختبارات config — القبول والرفض العربي عند الإقلاع (security.md §1).
 */
import { describe, expect, it } from "vitest";
import { DEV_ENCRYPTION_KEY_BASE64, generateEncryptionKeyBase64, loadConfig } from "./config.js";

const KEY = generateEncryptionKeyBase64();

const VALID_ENV: Record<string, string> = {
  NODE_ENV: "test",
  PORT: "3111",
  LOG_LEVEL: "warn",
  DATABASE_URL: "postgresql://localhost:5432/fixture",
  REDIS_URL: "redis://localhost:6379",
  ENCRYPTION_KEY: KEY,
  LLM_PROVIDER: "mock",
  LLM_MONTHLY_BUDGET_USD: "25",
};

describe("بوابة مفتاح التطوير", () => {
  const devKey = DEV_ENCRYPTION_KEY_BASE64;
  const validBase = {
    DATABASE_URL: "postgresql://localhost:5432/fixture",
    REDIS_URL: "redis://localhost:6380",
    ENCRYPTION_KEY: devKey,
    LLM_PROVIDER: "mock",
  };
  it("النمط الحي بالمفتاح المدمج ⇒ رفض إقلاع صريح", () => {
    const result = loadConfig({ ...validBase, PERSISTENCE: "live" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("مفتاح التشفير التطويري المدمج مرفوض");
  });
  it("الإنتاج بالمفتاح المدمج ⇒ رفض، والتطوير به يقبل", () => {
    const production = loadConfig({ ...validBase, NODE_ENV: "production" });
    expect(production.ok).toBe(false);
    expect(loadConfig({ ...validBase, NODE_ENV: "development" }).ok).toBe(true);
    expect(loadConfig({ ...validBase, PERSISTENCE: "memory" }).ok).toBe(true);
  });
});

describe("loadConfig", () => {
  it("يقبل بيئة سليمة ويحلل الأنواع والمفاتيح كما هي", () => {
    const result = loadConfig(VALID_ENV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.port).toBe(3111);
    expect(result.value.encryptionKey).toHaveLength(32);
    expect(result.value.llmMonthlyBudgetUsd).toBe(25);
    expect(result.value.logLevel).toBe("warn");
  });

  it("يملأ الافتراضيات المطابقة لـ.env.example", () => {
    const minimal: Record<string, string> = {
      DATABASE_URL: "x",
      REDIS_URL: "y",
      ENCRYPTION_KEY: generateEncryptionKeyBase64(),
    };
    const result = loadConfig(minimal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodeEnv).toBe("development");
    expect(result.value.port).toBe(3000);
    expect(result.value.llmProvider).toBe("mock");
    expect(result.value.llmMonthlyBudgetUsd).toBe(50);
  });

  it("يرفض مفتاح تشفير ناقصاً برسالة عربية صريحة", () => {
    const weak = { ...VALID_ENV, ENCRYPTION_KEY: Buffer.from("قصير جداً").toString("base64") };
    const result = loadConfig(weak);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("رفض الإقلاع");
    expect(result.error.message).toContain("ENCRYPTION_KEY");
    expect(result.error.message).toContain("32 بايت");
  });

  it("يرفض غياب المفتاح كلياً برسالة عربية", () => {
    const missing: Record<string, string> = { ...VALID_ENV };
    delete missing["ENCRYPTION_KEY"];
    const result = loadConfig(missing);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/ENCRYPTION_KEY مفقود/u);
  });

  it("يرفض base64 مزيفاً يحمل محارف غير معترف بها رغم الطول المتساوي", () => {
    // 32 حرفاً من خارج ألفباء base64 يفكها Node إلى أقل — يجب الرفض
    const fake = "*".repeat(44);
    const result = loadConfig({ ...VALID_ENV, ENCRYPTION_KEY: fake });
    expect(result.ok).toBe(false);
  });

  it("يجمع كل أخطاء الحقول الناقصة في رسالة واحدة لا يوقفه أول خطأ", () => {
    const result = loadConfig({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("DATABASE_URL");
    expect(result.error.message).toContain("REDIS_URL");
    expect(result.error.message).toContain("ENCRYPTION_KEY");
  });

  it("يرفض PORT خارج المدى وميزانية سالبة", () => {
    const badPort = loadConfig({ ...VALID_ENV, PORT: "99999" });
    expect(badPort.ok).toBe(false);

    const negativeBudget = loadConfig({ ...VALID_ENV, LLM_MONTHLY_BUDGET_USD: "-5" });
    expect(negativeBudget.ok).toBe(false);
  });

  it("يقبل PERSISTENCE=live ويحفظ النمط، والافتراضي memory", () => {
    const live = loadConfig({ ...VALID_ENV, PERSISTENCE: "live" });
    expect(live.ok).toBe(true);
    if (live.ok) expect(live.value.persistence).toBe("live");

    const memory = loadConfig(VALID_ENV);
    if (memory.ok) expect(memory.value.persistence).toBe("memory");

    const invalid = loadConfig({ ...VALID_ENV, PERSISTENCE: "oracle" });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.message).toContain("PERSISTENCE يقبل memory|live");
  });

  it("يرفض اختيار مزود شبكة دون مفتاحه برسالة عربية — وmock يحتاج لا شيء", () => {
    const noAnthropic = loadConfig({ ...VALID_ENV, LLM_PROVIDER: "anthropic" });
    expect(noAnthropic.ok).toBe(false);
    if (!noAnthropic.ok) {
      expect(noAnthropic.error.message).toContain("ANTHROPIC_API_KEY مفقود");
      expect(noAnthropic.error.message).toContain("LLM_PROVIDER=anthropic");
    }

    const noOpenai = loadConfig({ ...VALID_ENV, LLM_PROVIDER: "openai", ANTHROPIC_API_KEY: "موجود" });
    expect(noOpenai.ok).toBe(false);
    if (!noOpenai.ok) expect(noOpenai.error.message).toContain("OPENAI_API_KEY مفقود");

    // مفتاح فارغ بمسافات يعامل كغياب
    const blank = loadConfig({ ...VALID_ENV, LLM_PROVIDER: "openai", OPENAI_API_KEY: "   " });
    expect(blank.ok).toBe(false);

    const withKey = loadConfig({ ...VALID_ENV, LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-real" });
    expect(withKey.ok).toBe(true);

    const mockNeedsNothing = loadConfig({ ...VALID_ENV, LLM_PROVIDER: "mock" });
    expect(mockNeedsNothing.ok).toBe(true);
  });
});

describe("بوابة KMS في الإنتاج", () => {
  it("الإنتاج بمزود local الافتراضي ⇒ رفض صريح (لا KMS خارجي معتمد بعد)", () => {
    const result = loadConfig({
      ...VALID_ENV,
      NODE_ENV: "production",
      PERSISTENCE: "live",
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-real",
      ORCH_SNAPSHOT_PRIVATE_KEY: VALID_ENV.ENCRYPTION_KEY,
      CERT_SIGNING_PRIVATE_KEY: VALID_ENV.ENCRYPTION_KEY,
      HITL_SIGNING_PRIVATE_KEY: VALID_ENV.ENCRYPTION_KEY,
      RETENTION_POLICY_JSON: '{"episodicEventsDays":7,"signedSnapshotsDays":7,"runArchives":"permanent","certificates":"permanent","artifacts":"permanent","auditLog":"permanent","revocations":"permanent","semanticCore":"tenant-lifetime","sessions":"permanent","loginTransactions":"permanent","operationalLogs":"permanent","backups":"permanent","memoryWorking":"ephemeral","memoryVector":"permanent","flywheelLessons":"permanent","ssoConfig":"tenant-lifetime"}',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("KMS_PROVIDER=local مرفوض في الإنتاج");
  });
});

describe("بوابة سياسة الاحتفاظ", () => {
  // ملاحظة تصميمية: فك السياسة نفسه مستقل عن البيئة، و«الإنتاج» محجوب
  // أصلاً ببوابة KMS (لا مزود خارجي معتمد بعد) — لذا تُختبر أسباب الرفض
  // الإنتاجية على productionEnv الحقيقي، وفك القيم على بيئة تطوير.
  it("غياب RETENTION_POLICY_JSON في الإنتاج ⇒ رفض فاشل مغلق", () => {
    const result = loadConfig({ ...VALID_ENV, NODE_ENV: "production" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("RETENTION_POLICY_JSON مفقود في الإنتاج");
  });

  it("JSON غير سليم ⇒ رفض برسالة عربية", () => {
    const result = loadConfig({ ...VALID_ENV, RETENTION_POLICY_JSON: "{not-json" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("RETENTION_POLICY_JSON");
  });

  it("حقل زائد (strict) ⇒ رفض — لا حقول صامتة", () => {
    const result = loadConfig({ ...VALID_ENV, RETENTION_POLICY_JSON: '{"episodicEventsDays":3,"signedSnapshotsDays":14,"runArchives":"permanent","certificates":"permanent","artifacts":"permanent","auditLog":"permanent","revocations":"permanent","semanticCore":"tenant-lifetime","sessions":"permanent","loginTransactions":"permanent","operationalLogs":"permanent","backups":"permanent","memoryWorking":"ephemeral","memoryVector":"permanent","flywheelLessons":"permanent","ssoConfig":"tenant-lifetime","extra":1}' });
    expect(result.ok).toBe(false);
  });

  it("سياسة سليمة تُحلل بقيمها — auditLog غير الدائم يرفض", () => {
    const good = loadConfig({ ...VALID_ENV, RETENTION_POLICY_JSON: '{"episodicEventsDays":3,"signedSnapshotsDays":14,"runArchives":365,"certificates":"permanent","artifacts":30,"auditLog":"permanent","revocations":"permanent","semanticCore":"tenant-lifetime","sessions":90,"loginTransactions":30,"operationalLogs":90,"backups":35,"memoryWorking":"ephemeral","memoryVector":180,"flywheelLessons":365,"ssoConfig":"tenant-lifetime"}' });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.value.retentionPolicy.episodicEventsDays).toBe(3);
      expect(good.value.retentionPolicy.signedSnapshotsDays).toBe(14);
      expect(good.value.retentionPolicy.runArchives).toBe(365);
      expect(good.value.retentionPolicy.artifacts).toBe(30);
      expect(good.value.retentionPolicy.auditLog).toBe("permanent");
    }
    const badAudit = loadConfig({ ...VALID_ENV, RETENTION_POLICY_JSON: '{"episodicEventsDays":3,"signedSnapshotsDays":14,"runArchives":"permanent","certificates":"permanent","artifacts":"permanent","auditLog":30,"revocations":"permanent","semanticCore":"tenant-lifetime","sessions":"permanent","loginTransactions":"permanent","operationalLogs":"permanent","backups":"permanent","memoryWorking":"ephemeral","memoryVector":"permanent","flywheelLessons":"permanent","ssoConfig":"tenant-lifetime"}' });
    expect(badAudit.ok).toBe(false);
  });

  it("التطوير بلا سياسة يرث الافتراضي الموثق (7/7/دائم) — بلا سياسات صامتة جديدة", () => {
    const dev = loadConfig(VALID_ENV);
    expect(dev.ok).toBe(true);
    if (dev.ok) {
      expect(dev.value.retentionPolicy.episodicEventsDays).toBe(7);
      expect(dev.value.retentionPolicy.signedSnapshotsDays).toBe(7);
      expect(dev.value.retentionPolicy.auditLog).toBe("permanent");
    }
  });
});

describe("فئات الفحص الحي من الإعداد", () => {
  it("الافتراضي مغلق — بلا env لا فئات حية (fail-closed التاريخي)", () => {
    const result = loadConfig(VALID_ENV);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.liveProbesEnabled).toBe(false);
      expect(result.value.sandboxProbesEnabled).toBe(false);
    }
  });

  it('"1" يفعّل الفئتين و"0" يبقي الإغلاق — لا تفسير لغير الثنائي', () => {
    const on = loadConfig({ ...VALID_ENV, AGENTBRIDGE_LIVE_PROBES: "1", AGENTBRIDGE_SANDBOX_PROBES: "1" });
    expect(on.ok).toBe(true);
    if (on.ok) {
      expect(on.value.liveProbesEnabled).toBe(true);
      expect(on.value.sandboxProbesEnabled).toBe(true);
    }
    const off = loadConfig({ ...VALID_ENV, AGENTBRIDGE_LIVE_PROBES: "0", AGENTBRIDGE_SANDBOX_PROBES: "0" });
    expect(off.ok).toBe(true);
    if (off.ok) {
      expect(off.value.liveProbesEnabled).toBe(false);
      expect(off.value.sandboxProbesEnabled).toBe(false);
    }
  });

  it('قيمة غير "0"/"1" ⇒ رفض إقلاع برسالة عربية محددة للحقل', () => {
    const bad = loadConfig({ ...VALID_ENV, AGENTBRIDGE_LIVE_PROBES: "yes" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.message).toContain("AGENTBRIDGE_LIVE_PROBES");
    const badSandbox = loadConfig({ ...VALID_ENV, AGENTBRIDGE_SANDBOX_PROBES: "true" });
    expect(badSandbox.ok).toBe(false);
    if (badSandbox.ok) return;
    expect(badSandbox.error.message).toContain("AGENTBRIDGE_SANDBOX_PROBES");
  });
});
