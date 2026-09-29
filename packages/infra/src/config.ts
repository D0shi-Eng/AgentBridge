/**
 * إعدادات المنصة — تحقق Zod صارم عند الإقلاع (وثيقة security.md §1 والقاعدة 15).
 *
 * المفاتيح نفسها المعلنة في `.env.example` لا غير. أي غياب أو ضعف —
 * وأخطرها ENCRYPTION_KEY — يرفض الإقلاع برسالة عربية محددة قبل أي سطر عمل.
 * الدالة نقية تستقبل مصدر متغيرات البيئة معلمةً فتُختبر دون لمس process.env.
 */

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AppError, err, ok, type Result } from "@agentbridge/shared";
import { JwksHostsSchema } from "./jwks/policy.js";
import { arabicIssue } from "./config-messages.js";

export type LlmProviderName = "anthropic" | "openai" | "mock";

/** نمط التخزين: memory افتراضي للتطوير/الاختبار، live يقلع فوق PostgreSQL+Redis الحيّتين */
export type PersistenceMode = "memory" | "live";

/** مفتاح التطوير/الاختبار — موضعه الوحيد؛ live/production يرفضه صراحة
 * مفتاح معلن في المصدر لا يحمي بيانات حقيقية. */
export const DEV_ENCRYPTION_KEY_BASE64 = "EBcppg4v6Q3xjtmuJmiIfD5LrJOFq9AhquEZVCEAhX8=";

/** إعدادات جاهزة للاستهلاك — مفتاح التشفير مفكوك الترميز مرة واحدة هنا */
export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** مفتاح AES-256-GCM فك ترميزه (32 بايت) — لا يُسجل ولا يُعرض أبداً */
  readonly encryptionKey: Buffer;
  readonly llmProvider: LlmProviderName;
  /** مفاتيح مزودي الشبكة — فارغة عند mock، إلزامية عند anthropic/openai (مرفوض قبل الإقلاع) */
  readonly anthropicApiKey: string;
  readonly openaiApiKey: string;
  readonly llmMonthlyBudgetUsd: number;
  readonly persistence: PersistenceMode;
  /** الأصل الوحيد المقبول لطلبات المتصفح وredirect ثابت لا يبنى من Host. */
  readonly appOrigin: string;
  readonly oidcRedirectUri: string;
  /**
   * بيئة HTTPS التدريبية: تفرض شكل كوكيز الإنتاج
   * (__Host- + Secure) وHSTS فوق TLS محلي. تُشدّد الأمن ولا تخففه أبداً،
   * وافتراضها غائب؛ الإنتاج يتجاهلها لأنه أشدّ أصلاً.
   */
  readonly stagingHttps: boolean;
  /**
   * تفعيل الفئات الحية من إعداد الخادم الموثوق (env) — الافتراضي معطل
   * fail-closed: بلا فئات حية تنتهي تشغيلات المنصة بالرفض الموثق
   * LIVE_EVIDENCE_MISSING ولا تُمنح شهادة. المصدر الوحيد غير الاختباري.
   */
  readonly liveProbesEnabled: boolean;
  /** إقلاع الخادم المولد داخل حاوية العزل حصراً عند الفحص الحي — يلزم مع liveProbesEnabled */
  readonly sandboxProbesEnabled: boolean;
  /** جلسة الوضع المحلي: تفعيل تأسيس جلسة تلقائي للوحة جهاز واحد */
  readonly localBootstrapEnabled: boolean;
  /** مساحة العمل المحلية المؤتمتة — إلزامية عند تفعيل المسار المحلي */
  readonly localTenantId?: string;
  /** اعتماد مساحة العمل المحلية — إلزامية عند تفعيل المسار المحلي */
  readonly localCredentialId?: string;
  /** توكن حماية /metrics — غيابه في الإنتاج يخفي المسار كلياً */
  readonly metricsToken?: string;
  /**
   * مفاتيح التوقيع الثلاثة من إعداد الخادم (PKCS8 base64 Ed25519):
   * snapshots + شهادة + HITL. غيابها في التطوير يعني مفاتيح عابرة موثقة؛
   * الإنتاج يرفض الإقلاع بلا الثلاثة (لا مفتاح جديد لكل restart).
   */
  readonly orchSnapshotPrivateKey?: string;
  /** مفاتيح عامة سابقة (SPKI base64 مفصولة بفواصل) لتحقق الدوران قراءةً فقط */
  readonly orchSnapshotVerifyPublicKeys: readonly string[];
  readonly certSigningPrivateKey?: string;
  readonly hitlSigningPrivateKey?: string;
  /**
   * معاملات سقف الحجز التقني (ليست تسعيراً تجارياً — القرار
   * التجاري يبقى منفصلاً موثقاً): ceiling = max(min, أحرف/1000 × سعر-تقني × معامل).
   * القيم افتراضيات محافظة معلنة في .env.example لا سياسة تجارية صامتة.
   */
  readonly llmReservationCeilingFactor: number;
  readonly llmReservationPriceUsdPer1kChars: number;
  readonly llmReservationMinUsd: number;
  /**
   * مزود مفاتيح التشفير: القيمة الوحيدة المنفَّذة اليوم
   * `local` (مزود ثابت محلي للاختبار/التطوير) — الإنتاج يرفضه صراحةً
   * (لا يوجد مزود KMS خارجي معتمد بعد: EXTERNAL_KMS = NOT_VERIFIED وقرار
   * معلق). إضافة مزود خارجي لاحقاً توسّع هذا الاثنين فقط.
   */
  readonly kmsProvider: "local";
  /** مفاتيح شهادة عامة سابقة (SPKI base64 بفواصل) لنافذة الدوران */
  readonly certSigningVerifyPublicKeys: readonly string[];
  /** keyIds ملغاة (hex16 بفواصل) — توقيع بمفتاح ملغى = revoked */
  readonly certSigningRevokedKeyIds: readonly string[];
  /** سياسة الاحتفاظ المعلنة — إلزامية في الإنتاج (fail-closed) */
  readonly retentionPolicy: RetentionPolicy;
}

/**
 * سياسة الاحتفاظ الصريحة — نوعها ومخططها والافتراضي
 * التطويري في retention-policy.ts (فصل لتماسك الوحدة).
 */
export type { RetentionPolicy } from "./retention-policy.js";
import { DEV_RETENTION_POLICY, RetentionPolicySchema, type RetentionPolicy } from "./retention-policy.js";
export { DEV_RETENTION_POLICY, RetentionPolicySchema };

const RawEnvSchema = z.object({
  JWKS_ALLOWED_HOSTS: JwksHostsSchema,
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  LLM_PROVIDER: z.enum(["anthropic", "openai", "mock"]).default("mock"),
  LLM_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(50),
  PERSISTENCE: z.enum(["memory", "live"]).default("memory"),
  APP_ORIGIN: z.string().url().default("http://127.0.0.1:3001"),
  OIDC_REDIRECT_URI: z.string().url().default("http://127.0.0.1:3000/auth/oidc/callback"),
  // مفتاح تدريبي اختياري — "1" أو "0" حصراً فلا غموض في بيئة النشر
  STAGING_HTTPS: z.enum(["0", "1"]).default("0"),
  // فئات الفحص الحي — قرار خادم موثوق حصراً ("0"/"1" لا غموض)، والافتراضي
  // "0" يحفظ الإغلاق التاريخي: بلا فئات حية لا تمنح شهادة أبداً
  AGENTBRIDGE_LIVE_PROBES: z.enum(["0", "1"]).default("0"),
  // إقلاع الخادم المولد للفحص الحي داخل حاوية العزل حصراً — لا تنفيذ على المضيف
  AGENTBRIDGE_SANDBOX_PROBES: z.enum(["0", "1"]).default("0"),
  // جلسة الوضع المحلي: تثبيت فردي على جهاز واحد يفتح اللوحة بجلسة تلقائية
  // محروسة (Origin + مضيفو الحلقة + ترويسة عميل اللوحة) — لا يلغي مصادقة
  // API ولا يعمل شبكياً، والمسار كله معطل دون هذا المفتاح
  LOCAL_BOOTSTRAP: z.enum(["0", "1"]).default("0"),
  LOCAL_TENANT_ID: z.string().min(1).max(200).optional(),
  LOCAL_CREDENTIAL_ID: z.string().min(1).max(200).optional(),
  METRICS_TOKEN: z.string().min(16).max(200).optional(),
  // مفاتيح التوقيع الثلاثة: base64 فقط هنا (فحص الصيغة النهائي Ed25519
  // عند التحميل في الحاوية — infra لا يعتمد orchestrator/evaluator)
  ORCH_SNAPSHOT_PRIVATE_KEY: z.string().min(1).optional(),
  ORCH_SNAPSHOT_VERIFY_PUBLIC_KEYS: z.string().default(""),
  CERT_SIGNING_PRIVATE_KEY: z.string().min(1).optional(),
  HITL_SIGNING_PRIVATE_KEY: z.string().min(1).optional(),
  // نافذة دوران مفاتيح الشهادة + قائمة إبطال keyIds
  CERT_SIGNING_VERIFY_PUBLIC_KEYS: z.string().default(""),
  CERT_SIGNING_REVOKED_KEY_IDS: z.string().default(""),
  // مزود KMS — "local" الوحيد المنفذ (مرفوض في الإنتاج)
  KMS_PROVIDER: z.enum(["local"]).default("local"),
  // سياسة الاحتفاظ JSON — إلزامية في الإنتاج
  RETENTION_POLICY_JSON: z.string().min(1).optional(),
  LLM_RESERVATION_CEILING_FACTOR: z.coerce.number().positive().max(1000).default(2),
  LLM_RESERVATION_PRICE_USD_PER_1K_CHARS: z.coerce.number().positive().max(1000).default(0.002),
  LLM_RESERVATION_MIN_USD: z.coerce.number().positive().default(0.01),
});


/** يفك ترميز المفتاح ويشدد على 32 بايت تماماً — ضعف المفتاح = رفض الإقلاع */
function decodeEncryptionKey(value: string): Buffer | null {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) return null;
  // Buffer.from بترميز base64 يتجاهل المحارف الغريبة بصمت — نتحقق بعكس إعادة الترميز
  if (decoded.toString("base64").replace(/=+$/u, "") !== value.replace(/=+$/u, "")) return null;
  return decoded;
}

/** يحمّل الإعدادات ويتحقق منها — !ok يعني رفض إقلاع برسالة عربية جامعة */
export function loadConfig(source: Readonly<Record<string, string | undefined>>): Result<AppConfig> {
  const parsed = RawEnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = [...new Set(parsed.error.issues.map((issue) => arabicIssue(String(issue.path[0] ?? "?"))))];
    return err(
      new AppError("CONFIG_INVALID", `رفض الإقلاع — إعدادات البيئة غير سليمة:\n- ${details.join("\n- ")}`, false, "critical"),
    );
  }
  const key = decodeEncryptionKey(parsed.data.ENCRYPTION_KEY);
  if (key === null) {
    return err(
      new AppError(
        "CONFIG_INVALID",
        `رفض الإقلاع — إعدادات البيئة غير سليمة:\n- ${arabicIssue("ENCRYPTION_KEY")} (يجب أن تفك إلى 32 بايت تماماً)`,
        false,
        "critical",
      ),
    );
  }
  // بوابة مفتاح التطوير: الحياة/الإنتاج بالمفتاح المدمج = رفض إقلاع صريح
  if ((parsed.data.PERSISTENCE === "live" || parsed.data.NODE_ENV === "production") &&
      parsed.data.ENCRYPTION_KEY.trim() === DEV_ENCRYPTION_KEY_BASE64) {
    return err(
      new AppError(
        "CONFIG_INVALID",
        `رفض الإقلاع — إعدادات البيئة غير سليمة:\n- مفتاح التشفير التطويري المدمج مرفوض في ${parsed.data.PERSISTENCE === "live" ? "النمط الحي" : "الإنتاج"} — ولّد مفتاحاً حقيقياً بـ32 بايت عبر generateEncryptionKeyBase64 ولا تشاركه في المصدر`,
        false,
        "critical",
      ),
    );
  }
  // بوابة جلسة الوضع المحلي: تفعيلها بلا هوية مساحة العمل واعتمادها =
  // رفض إقلاع — لا جلسة محلية نصف مهيأة
  if (parsed.data.LOCAL_BOOTSTRAP === "1") {
    const missingLocal = [
      ...(parsed.data.LOCAL_TENANT_ID === undefined ? ["LOCAL_TENANT_ID"] : []),
      ...(parsed.data.LOCAL_CREDENTIAL_ID === undefined ? ["LOCAL_CREDENTIAL_ID"] : []),
    ];
    if (missingLocal.length > 0) {
      return err(
        new AppError(
          "CONFIG_INVALID",
          `رفض الإقلاع — إعدادات البيئة غير سليمة:\n- LOCAL_BOOTSTRAP=1 يستلزم ${missingLocal.join(" و")} — أكمل إعداد المسار المحلي أو أعد LOCAL_BOOTSTRAP=0`,
          false,
          "critical",
        ),
      );
    }
  }
  // بوابة مزودي الشبكة: اختيار مزود دون مفتاحه يرفض الإقلاع قبل أي نداء (وثيقة security.md §1)
  const missingProviderKey =
    parsed.data.LLM_PROVIDER === "anthropic" && parsed.data.ANTHROPIC_API_KEY.trim().length === 0
      ? "ANTHROPIC"
      : parsed.data.LLM_PROVIDER === "openai" && parsed.data.OPENAI_API_KEY.trim().length === 0
        ? "OPENAI"
        : null;
  if (missingProviderKey !== null) {
    return err(
      new AppError(
        "CONFIG_INVALID",
        `رفض الإقلاع — إعدادات البيئة غير سليمة:\n- ${missingProviderKey}_API_KEY مفقود بينما LLM_PROVIDER=${parsed.data.LLM_PROVIDER} — لا يُختار مزود شبكة دون مفتاحه، وأعد LLM_PROVIDER=mock للعمل بلا شبكة`,
        false,
        "critical",
      ),
    );
  }
  // الإنتاج بلا تخزين دائم أو بمزود وهمي = رفض إقلاع صريح.
  // «إنتاج» يفترض بيانات حقيقية؛ memory يفقدها عند الإيقاف وmock يقيّم
  // بعين وهمية — كلاهما يصنع منصة تبدو حية وهي لعبة.
  if (parsed.data.NODE_ENV === "production") {
    const productionViolations = [
      ...(parsed.data.PERSISTENCE === "memory"
        ? ["- PERSISTENCE=memory مرفوض في الإنتاج — بيانات العملاء تُفقد عند كل إيقاف؛ استخدم live فوق PostgreSQL/Redis حقيقتين"]
        : []),
      ...(parsed.data.LLM_PROVIDER === "mock"
        ? ["- LLM_PROVIDER=mock مرفوض في الإنتاج — مخرجات وهمية لا تصدر شهادات حقيقية؛ اختر مزوداً شبكياً بمفتاحه"]
        : []),
      // الإنتاج بلا مفاتيح ثابتة = استئناف/موافقة/شهادة
      // تنكسر عند أول restart بمفتاح عابر — مرفوض قبل الإقلاع لا بعده
      ...(parsed.data.ORCH_SNAPSHOT_PRIVATE_KEY === undefined
        ? ["- ORCH_SNAPSHOT_PRIVATE_KEY مفقود في الإنتاج — لا مفتاح عابر لكل restart؛ مرر PKCS8 base64 لـEd25519"]
        : []),
      ...(parsed.data.CERT_SIGNING_PRIVATE_KEY === undefined
        ? ["- CERT_SIGNING_PRIVATE_KEY مفقود في الإنتاج — الشهادات بلا توقيع ثابت مرفوضة؛ مرر PKCS8 base64 لـEd25519"]
        : []),
      ...(parsed.data.HITL_SIGNING_PRIVATE_KEY === undefined
        ? ["- HITL_SIGNING_PRIVATE_KEY مفقود في الإنتاج — تذاكر الموافقة بلا مفتاح ثابت ترفض بين النسخ؛ مرر PKCS8 base64 لـEd25519"]
        : []),
      // لا مزود KMS خارجي معتمد بعد — الإنتاج بمزود محلي
      // اختباري = أسرار العملاء بمفتاح اختبار؛ رفض صريح حتى يُعتمد مزود حقيقي
      ...(parsed.data.KMS_PROVIDER === "local"
        ? ["- KMS_PROVIDER=local مرفوض في الإنتاج — لا يوجد مزود KMS خارجي معتمد بعد (EXTERNAL_KMS = NOT_VERIFIED، قرار معلق)؛ لا يُقلع الإنتاج بمزود مفاتيح اختباري"]
        : []),
      // غياب سياسة الاحتفاظ المعلنة = رفض (لا سياسات صامتة)
      ...(parsed.data.RETENTION_POLICY_JSON === undefined
        ? ["- RETENTION_POLICY_JSON مفقود في الإنتاج — علن سياسة الاحتفاظ لكل صنف بيانات (أيام أو permanent) قبل الإقلاع؛ المدد التجارية قرار إداري موثق"]
        : []),
    ];
    if (productionViolations.length > 0) {
      return err(
        new AppError(
          "CONFIG_INVALID",
          `رفض الإقلاع — وضع إنتاجي بأرضية غير إنتاجية:\n${productionViolations.join("\n")}`,
          false,
          "critical",
        ),
      );
    }
  }
  // فحص صيغة base64 لمفاتيح الإنتاج قبل أي تحميل أعمق — الرفض مبكراً وواضحاً
  const signingKeys = [
    ["ORCH_SNAPSHOT_PRIVATE_KEY", parsed.data.ORCH_SNAPSHOT_PRIVATE_KEY],
    ["CERT_SIGNING_PRIVATE_KEY", parsed.data.CERT_SIGNING_PRIVATE_KEY],
    ["HITL_SIGNING_PRIVATE_KEY", parsed.data.HITL_SIGNING_PRIVATE_KEY],
  ] as const;
  for (const [name, value] of signingKeys) {
    if (value !== undefined && !/^[A-Za-z0-9+/=\r\n_-]+$/u.test(value.trim())) {
      return err(
        new AppError("CONFIG_INVALID", `رفض الإقلاع — ${name} ليس base64 صالحاً (PKCS8 base64 لـEd25519 مطلوب)`, false, "critical"),
      );
    }
  }
  const verifyKeys = parsed.data.ORCH_SNAPSHOT_VERIFY_PUBLIC_KEYS
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  // حلقة تحقق شهادات (الدوران) وقائمة keyIds ملغاة بصيغة hex16
  const certVerifyKeys = parsed.data.CERT_SIGNING_VERIFY_PUBLIC_KEYS
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  const certRevokedKeyIds = parsed.data.CERT_SIGNING_REVOKED_KEY_IDS
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);
  for (const keyId of certRevokedKeyIds) {
    if (!/^[0-9a-f]{16}$/u.test(keyId)) {
      return err(new AppError("CONFIG_INVALID", `رفض الإقلاع — CERT_SIGNING_REVOKED_KEY_IDS يحوي معرفاً مخالفاً (${keyId}): كل keyId هو 16 محرفاً hex`, false, "critical"));
    }
  }
  // فك سياسة الاحتفاظ — JSON مخالف يرفض الإقلاع واضحاً
  let retentionPolicy: RetentionPolicy = DEV_RETENTION_POLICY;
  if (parsed.data.RETENTION_POLICY_JSON !== undefined) {
    let rawPolicy: unknown;
    try {
      rawPolicy = JSON.parse(parsed.data.RETENTION_POLICY_JSON);
    } catch {
      return err(new AppError("CONFIG_INVALID", "رفض الإقلاع — RETENTION_POLICY_JSON ليس JSON سليماً", false, "critical"));
    }
    const policyParsed = RetentionPolicySchema.safeParse(rawPolicy);
    if (!policyParsed.success) {
      return err(
        new AppError(
          "CONFIG_INVALID",
          `رفض الإقلاع — RETENTION_POLICY_JSON ليس سياسة احتفاظ سليمة: ${policyParsed.error.issues[0]?.path.join(".") ?? "?"} — كل صنف بيانات له حقل صريح: episodicEventsDays/signedSnapshotsDays بالأيام؛ runArchives/certificates/artifacts/sessions/loginTransactions/operationalLogs/backups/memoryVector/flywheelLessons برقم أيام أو "permanent"؛ revocations/auditLog="permanent" حصراً؛ semanticCore/ssoConfig="tenant-lifetime"؛ memoryWorking="ephemeral"`,
          false,
          "critical",
        ),
      );
    }
    retentionPolicy = policyParsed.data;
  }
  return ok({
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
    databaseUrl: parsed.data.DATABASE_URL,
    redisUrl: parsed.data.REDIS_URL,
    encryptionKey: key,
    llmProvider: parsed.data.LLM_PROVIDER,
    anthropicApiKey: parsed.data.ANTHROPIC_API_KEY.trim(),
    openaiApiKey: parsed.data.OPENAI_API_KEY.trim(),
    llmMonthlyBudgetUsd: parsed.data.LLM_MONTHLY_BUDGET_USD,
    persistence: parsed.data.PERSISTENCE,
    appOrigin: parsed.data.APP_ORIGIN,
    oidcRedirectUri: parsed.data.OIDC_REDIRECT_URI,
    stagingHttps: parsed.data.STAGING_HTTPS === "1",
    liveProbesEnabled: parsed.data.AGENTBRIDGE_LIVE_PROBES === "1",
    sandboxProbesEnabled: parsed.data.AGENTBRIDGE_SANDBOX_PROBES === "1",
    localBootstrapEnabled: parsed.data.LOCAL_BOOTSTRAP === "1",
    ...(parsed.data.LOCAL_TENANT_ID !== undefined ? { localTenantId: parsed.data.LOCAL_TENANT_ID } : {}),
    ...(parsed.data.LOCAL_CREDENTIAL_ID !== undefined ? { localCredentialId: parsed.data.LOCAL_CREDENTIAL_ID } : {}),
    ...(parsed.data.METRICS_TOKEN !== undefined ? { metricsToken: parsed.data.METRICS_TOKEN } : {}),
    ...(parsed.data.ORCH_SNAPSHOT_PRIVATE_KEY !== undefined ? { orchSnapshotPrivateKey: parsed.data.ORCH_SNAPSHOT_PRIVATE_KEY.trim() } : {}),
    orchSnapshotVerifyPublicKeys: verifyKeys,
    ...(parsed.data.CERT_SIGNING_PRIVATE_KEY !== undefined ? { certSigningPrivateKey: parsed.data.CERT_SIGNING_PRIVATE_KEY.trim() } : {}),
    ...(parsed.data.HITL_SIGNING_PRIVATE_KEY !== undefined ? { hitlSigningPrivateKey: parsed.data.HITL_SIGNING_PRIVATE_KEY.trim() } : {}),
    certSigningVerifyPublicKeys: certVerifyKeys,
    certSigningRevokedKeyIds: certRevokedKeyIds,
    kmsProvider: parsed.data.KMS_PROVIDER,
    retentionPolicy,
    llmReservationCeilingFactor: parsed.data.LLM_RESERVATION_CEILING_FACTOR,
    llmReservationPriceUsdPer1kChars: parsed.data.LLM_RESERVATION_PRICE_USD_PER_1K_CHARS,
    llmReservationMinUsd: parsed.data.LLM_RESERVATION_MIN_USD,
  });
}

/** يولد مفتاح تشفير صالحاً بترميز base64 — لأغراض التطوير والاختبار حصراً */
export function generateEncryptionKeyBase64(): string {
  return randomBytes(32).toString("base64");
}
