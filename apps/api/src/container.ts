/**
 * الحاوية — تجميع يدوي صريح للتبعيات بلا سحر حقن:
 *   config ← logger ← مخازن الذاكرة ← سلسلة التدقيق ← خدمة التشغيل.
 *
 * المحولات داخل الذاكرة هي الافتراضي؛ الشبكية (Redis/pgvector/Prisma) تُمرر
 * بنفس المنافذ عند توفرها. overrides تخدم الاختبارات. المساعدون
 * (redis-connector/provider-helpers/resolve-stores/resolve-flywheel/resolve-sso) منعزلون.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPrismaCostLedger,
  DEV_ENCRYPTION_KEY_BASE64,
  HashChainAuditLog,
  loadConfig,
  type AppConfig,
  type SsoStore,
  createStaticKeyProvider,
  type KeyProvider,
  exchangeAuthorizationCode,
  type OidcCodeExchanger,
  createPrismaAuthStore,
} from "@agentbridge/infra";
import {
  type EpisodicStore,
  type FlywheelStore,
  type SemanticStore,
  type VectorStore,
  createInMemoryAuthStore,
  createInMemoryRunArchiveStore,
  type AuthStore,
  type RunArchiveStore,
} from "@agentbridge/memory";
import {
  createInMemoryRunLeaseStore,
  createPrismaRunArchiveStore,
  createRedisRunLeaseStore,
  createRedisReservationLedger,
  createRedisRateLimiter,
  createRedisSseQuotaStore,
  RATE_LIMIT_RULES,
  RATE_WINDOW_MS,
  type DistributedRateLimiter,
} from "@agentbridge/infra";
import { createInMemoryCostLedger, type LlmProvider } from "@agentbridge/llm";
import type { SnapshotKeyRing, SnapshotSigningMaterial } from "@agentbridge/orchestrator";
import type { SigningKeyMaterial } from "@agentbridge/evaluator";
import {
  generateHitlSigningMaterial,
  createInMemoryApprovalConsumedStore,
  createRedisApprovalConsumedStore,
  HITL_APPROVAL_TTL_MS_DEFAULT,
  type HitlSigningMaterial,
  type ApprovalConsumedStore,
} from "./run-service/hitl-approval.js";
import { RunService } from "./run-service.js";
import { SSE_MAX_CONNECTIONS_PER_TENANT } from "./run-service/sse-connection.js";
import { createProviderFactoryForConfig, estimateCostFromResponse, wrapDelayed } from "./container/provider-helpers.js";
import { resolveStores } from "./container/resolve-stores.js";
import { resolveFlywheel } from "./container/resolve-flywheel.js";
import { resolveSso } from "./container/resolve-sso.js";
import { resolveSigningMaterials, ceilingUsdOfFactory } from "./container/resolve-signing.js";
import { snapshotKeyRingOf } from "./run-service/snapshot-read.js";

export interface ApiContainer {
  readonly config: AppConfig;
  readonly episodic: EpisodicStore;
  readonly semantic: SemanticStore;
  readonly vectorStore: VectorStore;
  readonly flywheel: FlywheelStore;
  readonly ssoStore: SsoStore;
  readonly authStore: AuthStore;
  readonly keyProvider: KeyProvider;
  readonly oidcExchanger: OidcCodeExchanger;
  readonly audit: HashChainAuditLog;
  readonly runs: RunService;
  readonly workRoot: string;
  readonly suspendAfter?: import("@agentbridge/shared").StageId;
  /** تفعيل الفئات الحية من إعداد الخادم الموثوق — لا من الطلب */
  readonly liveProbes?: boolean;
  /** الفحوص الحية داخل حاوية معزولة حصراً — إعداد خادم موثوق لا طلب */
  readonly sandboxProbes?: boolean;
  /**
   * مادة توقيع تذاكر الموافقة البشرية ومخزن الاستهلاك. الإعداد
   * الحي يمرر مفتاحاً ثابتاً من env ومخزن استهلاك Redis ذرياً بين النسخ؛
   * الافتراضي (تطوير) يبقى عابراً لكل عملية بخريطة محلية — موثق لا مخفي.
   */
  readonly hitl: { readonly material: HitlSigningMaterial; readonly consumed: ApprovalConsumedStore };
  /** الأرشيف الدائم — مسار approve/resume يقرأ منه بعد انتهاء TTL */
  readonly runArchive: RunArchiveStore;
  /**
   * مفاتيح التوقيع المحمولة للمسارات القرائية: مادة snapshots من
   * الإعداد (عابرة عند غيابه) + حلقة التحقق (الدوران) + مفاتيح الشهادة
   * العامة بـkeyId للتحقق العام في /verify.
   */
  readonly snapshotSigning?: SnapshotSigningMaterial;
  readonly snapshotKeyRing: SnapshotKeyRing;
  readonly certificateKeys: ReadonlyMap<string, import("node:crypto").KeyObject>;
  readonly certificateSigning?: SigningKeyMaterial;
  /**
   * keyIds شهادة ملغاة من إعداد الخادم (تسريب مفتاح مثلاً) —
   * /verify يمررها لمدقق التوقيع فيصبح السبب "revoked" موثقاً لا "malformed".
   */
  readonly certificateRevokedKeyIds: readonly string[];
  /**
   * الحصص الموزعة فوق Redis في النمط الحي: فشل مغلق معلن
   * (تعطل المخزن يرفض 503 لا يتجاوز الحد صامتاً). غيابها (تطوير/اختبار)
   * يعني حدوداً محلية العملية الموثقة في rate-limit.ts.
   */
  readonly distributedRateLimiters?: {
    readonly preAuth: DistributedRateLimiter;
    readonly tenantRead: DistributedRateLimiter;
    readonly tenantRun: DistributedRateLimiter;
  };
  /**
   * حصة اتصالات SSE الموزعة فوق Redis في النمط الحي:
   * العدّ مشترك بين النسخ بفشل مغلق (تعطل المخزن يرفض 503 لا يتجاوز
   * السقف صامتاً). غيابها (تطوير/اختبار) يعني العدّاد المحلي العملية
   * الموثق في sse-connection.ts.
   */
  readonly sseQuotaStore?: import("@agentbridge/infra").SseQuotaStore;
  readonly close?: () => Promise<void>;
}

export interface ContainerOverrides {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly episodic?: EpisodicStore;
  readonly semantic?: SemanticStore;
  readonly vectorStore?: VectorStore;
  readonly flywheel?: FlywheelStore;
  readonly ssoStore?: SsoStore;
  readonly authStore?: AuthStore;
  readonly keyProvider?: KeyProvider;
  readonly oidcExchanger?: OidcCodeExchanger;
  readonly workRoot?: string;
  readonly providerDelayMs?: number;
  readonly providerFactory?: () => LlmProvider;
  readonly suspendAfter?: import("@agentbridge/shared").StageId;
  readonly liveProbes?: boolean;
  readonly sandboxProbes?: boolean;
  /** تجاوز مادة توقيع HITL للاختبارات (حتمية المفاتيح) */
  readonly hitlMaterial?: HitlSigningMaterial;
}

/** بيئة تطوير افتراضية كاملة الصلاحية عندما لا يمرر المستدعي شيئاً */
export function developmentEnv(): Record<string, string> {
  // مفتاح تشفير 32 بايت مُرمّز base64 صحيح للتطوير
  const encryptionKey = DEV_ENCRYPTION_KEY_BASE64;
  return {
    NODE_ENV: "development",
    PORT: "3000",
    LOG_LEVEL: "info",
    DATABASE_URL: "postgresql://localhost/agentbridge-dev",
    REDIS_URL: "redis://localhost:6379",
    ENCRYPTION_KEY: encryptionKey,
    LLM_PROVIDER: "mock",
    LLM_MONTHLY_BUDGET_USD: "50",
    APP_ORIGIN: "http://127.0.0.1:3001",
    OIDC_REDIRECT_URI: "http://127.0.0.1:3000/auth/oidc/callback",
  };
}

/** async لأن نمط live يفحص الدور المقيد fail-closed عند الإقلاع */
export async function buildContainer(overrides: ContainerOverrides = {}): Promise<ApiContainer> {
  const configResult = loadConfig(overrides.env ?? developmentEnv());
  if (!configResult.ok) throw configResult.error;
  const config = configResult.value;

  // حل المخازن الثلاثة (Semantic, Episodic, Vector) عبر دالة مساعدة —
  // async لأن نمط live يفحص الدور المقيد fail-closed عند الإقلاع
  const { semantic, episodic, vectorStore, prisma, closers, redisViews } = await resolveStores(config, {
    semantic: overrides.semantic,
    episodic: overrides.episodic,
    vectorStore: overrides.vectorStore,
  });

  // حل مخزن Flywheel
  const flywheel = resolveFlywheel(config, overrides.flywheel, vectorStore, prisma);

  // حل مخزن SSO
  const ssoStore = resolveSso(overrides.ssoStore, prisma);
  // النمط الحي لا يرجع إلى Map محلية عند تعطل قاعدة الجلسات.
  const authStore = overrides.authStore ?? (prisma === undefined ? createInMemoryAuthStore() : createPrismaAuthStore(prisma));
  const keyProvider = overrides.keyProvider ?? createStaticKeyProvider(config.encryptionKey);

  const audit = new HashChainAuditLog(semantic);
  const budgetLedger = prisma !== undefined ? createPrismaCostLedger(prisma) : createInMemoryCostLedger();
  const baseFactory = overrides.providerFactory ?? createProviderFactoryForConfig(config);
  const providerFactory = overrides.providerDelayMs !== undefined ? wrapDelayed(baseFactory, overrides.providerDelayMs) : baseFactory;
  const workRoot = overrides.workRoot ?? mkdtempSync(join(tmpdir(), "agentbridge-runs-"));
  // الأرشفة الدائمة — Prisma في النمط الحي، داخل الذاكرة غيره
  const runArchive = prisma !== undefined ? createPrismaRunArchiveStore(prisma) : createInMemoryRunArchiveStore();

  // ── التكامل الفعلي للقفل والميزانية وHITL ومفاتيح التوقيع ──
  // القاعدة: النمط الحي (live) يدّعي التوزع فيجب أن تكون الضوابط التوزعية
  // حقيقية — قفل Redis ودفتر حجوزات Redis ومخزن استهلاك مشترك. لا fallback
  // صامت إلى داخل العملية في live: غياب Redis يفشل فوق أصلاً في resolveStores.
  const runLock = redisViews !== undefined
    ? createRedisRunLeaseStore(redisViews.lockCommands)
    : createInMemoryRunLeaseStore();
  const reservationLedger = redisViews !== undefined
    ? createRedisReservationLedger(redisViews.budgetCommands, () => config.llmMonthlyBudgetUsd)
    : undefined;
  const ceilingUsdOf = reservationLedger !== undefined ? ceilingUsdOfFactory(config) : undefined;

  const signing = resolveSigningMaterials(config);
  // مادة HITL: الإعداد الثابت أولاً ثم تجاوز الاختبارات ثم العابر (تطوير)
  const hitlMaterial = signing.hitl ?? overrides.hitlMaterial ?? generateHitlSigningMaterial();
  // مخزن الاستهلاك الأحادي: Redis SETNX ذري بين النسخ في live؛ عمر العلامة
  // يفوق أقصى عمر تذكرة فلا يفتح انتهاؤه إعادة استخدام لتذكرة صالحة
  const hitlConsumed = redisViews !== undefined
    ? createRedisApprovalConsumedStore(redisViews.setNx, { markerTtlMs: HITL_APPROVAL_TTL_MS_DEFAULT + 60 * 60 * 1000 })
    : createInMemoryApprovalConsumedStore();
  // محددات موزعة لكل قاعدة فوق نفس اتصال Redis بفشل مغلق —
  // المحلي يبقى للتطوير/الاختبار فقط (الفرق معلن في ApiContainer)
  const distributedRateLimiters = redisViews !== undefined
    ? {
        preAuth: createRedisRateLimiter(redisViews.lockCommands, { keyPrefix: "rl:preauth", limit: RATE_LIMIT_RULES.preAuthPerMinute, windowMs: RATE_WINDOW_MS, outagePolicy: "fail-closed" }),
        tenantRead: createRedisRateLimiter(redisViews.lockCommands, { keyPrefix: "rl:tread", limit: RATE_LIMIT_RULES.tenantReadPerMinute, windowMs: RATE_WINDOW_MS, outagePolicy: "fail-closed" }),
        tenantRun: createRedisRateLimiter(redisViews.lockCommands, { keyPrefix: "rl:trun", limit: RATE_LIMIT_RULES.tenantRunPerMinute, windowMs: RATE_WINDOW_MS, outagePolicy: "fail-closed" }),
      }
    : undefined;

  // حصة SSE الموزعة فوق نفس اتصال Redis — TTL شبكة أمان
  // الانهيار يفوق فترة heartbeat (15 ثانية) بمراحل، ويُجدَّد من الاتصال الحي
  const sseQuotaStore = redisViews !== undefined
    ? createRedisSseQuotaStore(redisViews.lockCommands, { keyPrefix: "sse:conn", limit: SSE_MAX_CONNECTIONS_PER_TENANT, ttlMs: 90_000 })
    : undefined;

  // فئات الفحص الحي: تجاوز الاختبارات أولاً ثم إعداد الخادم الموثوق من env
  // (loadConfig). `|| undefined` يُبقي الإغلاق كغياب فيحفظ السلوك التاريخي
  // حرفياً عند عدم التفعيل — بلا فئات حية لا تمنح شهادة (fail-closed).
  const liveProbes = overrides.liveProbes ?? (config.liveProbesEnabled || undefined);
  const sandboxProbes = overrides.sandboxProbes ?? (config.sandboxProbesEnabled || undefined);

  // الخدمة تُبنى قبل الإرجاع كي يصل إغلاقها
  // المنظم (مسح المؤقتات والمقود) إلى سلسلة close للحاوية
  const runs = new RunService({
    semantic,
    episodic,
    audit,
    providerFactory,
    workRoot,
    flywheel,
    runArchive,
    runLock,
    ...(liveProbes !== undefined ? { liveProbes } : {}),
    ...(sandboxProbes !== undefined ? { sandboxProbes } : {}),
      // مواد التوقيع الثابتة تصل المنسق عبر deps (snapshots + شهادة)
      ...(signing.snapshot !== undefined ? { snapshotSigning: signing.snapshot } : {}),
      ...(signing.snapshotVerifyKeys.size > 0 ? { snapshotVerifyKeys: signing.snapshotVerifyKeys } : {}),
      ...(signing.certificate !== undefined ? { certificateSigning: signing.certificate } : {}),
      // صلاحية snapshots من سياسة الاحتفاظ المعلنة
      ...(signing.snapshot !== undefined ? { snapshotTtlMs: config.retentionPolicy.signedSnapshotsDays * 24 * 60 * 60 * 1000 } : {}),
      budget: {
        monthlyBudgetUsd: config.llmMonthlyBudgetUsd,
        ledger: budgetLedger,
        estimateCostUsd: (_req, res) => estimateCostFromResponse(res),
        // الحجز الذري المسار الفعلي في live (قبله check-then-spend)
        ...(reservationLedger !== undefined && ceilingUsdOf !== undefined
          ? { reservationLedger, ceilingUsdOf }
          : {}),
      },
  });

  return {
    config,
    episodic,
    semantic,
    vectorStore,
    flywheel,
    ssoStore,
    authStore,
    keyProvider,
    oidcExchanger: overrides.oidcExchanger ?? exchangeAuthorizationCode,
    audit,
    workRoot,
    ...(overrides.suspendAfter !== undefined ? { suspendAfter: overrides.suspendAfter } : {}),
    ...(liveProbes !== undefined ? { liveProbes } : {}),
    ...(sandboxProbes !== undefined ? { sandboxProbes } : {}),
    hitl: { material: hitlMaterial, consumed: hitlConsumed },
    runArchive,
    ...(signing.snapshot !== undefined ? { snapshotSigning: signing.snapshot } : {}),
    // بلا إعداد مفاتيح تبقى حلقة مفتاح العملية العابر (تطوير موثق) —
    // حلقة فارغة تكسر كل قراءة snapshot؛ وبمفاتيح دوران فقط تُبنى منها الحلقة
    snapshotKeyRing: signing.snapshot !== undefined
      ? new Map([...signing.snapshotVerifyKeys, [signing.snapshot.keyId, signing.snapshot.publicKey]])
      : signing.snapshotVerifyKeys.size > 0
        ? snapshotKeyRingOf(undefined, signing.snapshotVerifyKeys)
        : snapshotKeyRingOf(),
    ...(signing.certificate !== undefined ? { certificateSigning: signing.certificate } : {}),
    ...(distributedRateLimiters !== undefined ? { distributedRateLimiters } : {}),
    ...(sseQuotaStore !== undefined ? { sseQuotaStore } : {}),
    // حلقة شهادات /verify = المفتاح الحالي + مفاتيح الدوران
    certificateKeys: new Map([
      ...signing.certificateVerifyKeys,
      ...(signing.certificate !== undefined ? [[signing.certificate.keyId, signing.certificate.publicKey] as const] : []),
    ]),
    // keyIds الملغاة تمرر لـ/verify فيصبح الرفض "revoked" موثقاً
    certificateRevokedKeyIds: signing.certificateRevokedKeyIds,
    // إغلاق الخدمة المنظم (مؤقتات/مقود/مستمعون) قبل مغلقي الشبكة
    ...(closers.length > 0
      ? { close: async (): Promise<void> => { runs.shutdown(); for (const closer of closers) await closer(); } }
      : { close: async (): Promise<void> => { runs.shutdown(); } }),
    runs,
  };
}
