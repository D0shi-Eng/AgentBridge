/**
 * المنفذ العام لحزمة infra — المحولات والمرافق البنيوية (وثيقة 03 §جدول الملكية).
 *
 * كل ما يُصدَّر هنا نقي بلا منطق نطاق: config، السجلات، التشفير،
 * سلسلة التدقيق، محول L1 الشبكي الشكل، ومبدئو صفوف L2.
 * المحولات تطابق منافذ packages/memory بنيوياً — الربط الجرياني
 * يتم في apps/api فلا تعتمد infra على memory جريانياً إطلاقاً.
 */

export {
  generateEncryptionKeyBase64,
  loadConfig,
  DEV_RETENTION_POLICY,
  RetentionPolicySchema,
  type AppConfig,
  type LlmProviderName,
  type RetentionPolicy,
} from "./config.js";
export { REDACTED, REDACT_PATHS, buildLoggerOptions, redactText, type FastifyLoggerOptions } from "./logger.js";
export {
  CryptoErrors,
  SCRYPT_PARAMS,
  decryptSecret,
  encryptSecret,
  generateApiKey,
  hashApiKey,
  newRunId,
  sha256Hex,
  stableStringify,
  verifyApiKey,
  verifyApiKeyAsync,
  hashApiKeyAsync,
  MAX_API_KEY_INPUT_CHARS,
} from "./crypto.js";
export {
  HashChainAuditLog,
  computeAuditHash,
  type AuditRecordInput,
  type AuditSinkPort,
} from "./audit-chain.js";
export { createRedisShapedEpisodicStore, type RedisCommandsLike } from "./redis-shape.js";
export {
  adaptRedisV6ForLock,
  createInMemoryRunLeaseStore,
  createRedisRunLeaseStore,
  type RedisLockCommands,
  type RunLeaseStore,
} from "./run-lock.js";
export {
  adaptRedisV6ForBudget,
  createRedisReservationLedger,
  type RedisBudgetCommands,
} from "./budget-redis-ledger.js";
export { createPrismaRunArchiveStore } from "./prisma-run-archive.js";
export { DEV_ENCRYPTION_KEY_BASE64 } from "./config.js";
export { LOOKUP_KEYS, assertRestrictedRole, withLookupPrisma, withTenantPrisma, type ScopedSetting } from "./prisma-scope.js";
export { EXPECTED_EXEC_ROLE, PROTECTED_TABLES, RestrictedRoleError } from "./prisma-scope-hardening.js";
export { createPrismaSemanticStore } from "./prisma-semantic-store.js";
export { createPrismaCostLedger } from "./prisma-cost-ledger.js";
export { currentMonthKey, type LlmSpendRow } from "./billing-mappers.js";
export { buildDeflatedZip, buildStoredZip, crc32, type ZipEntry } from "./zip-writer.js";
export {
  auditEntryFromRow,
  auditEntryToRow,
  type AuditTrailRow,
} from "./audit-mappers.js";
export {
  artifactFromRow,
  artifactToRow,
  certificateFromRow,
  certificateToRow,
  pipelineFromRow,
  pipelineToRow,
  projectFromRow,
  projectToRow,
  specFromRow,
  specToRow,
  tenantFromRow,
  tenantToRow,
  type ArtifactRow,
  type CertificateRow,
  type PipelineRow,
  type ProjectRow,
  type SpecRow,
  type TenantRow,
} from "./row-mappers.js";
export {
  cosineDistance,
  EMBEDDING_DIMS_L3,
  embeddingFromRow,
  embeddingToRow,
  type MemoryEmbeddingRow,
} from "./embedding-mappers.js";
export { createPgVectorStore, isPgVectorAvailable } from "./pgvector-store.js";
export { createPrismaFlywheelStore } from "./prisma-flywheel-store.js";
export { createPrismaAuthStore } from "./prisma-auth-store.js";
export { lessonFromRow, lessonToRow, type FlywheelLessonRow } from "./flywheel-mappers.js";
export { ssoCreateRow, ssoUpdateRow, ssoFromRow, type SsoConfigRow } from "./sso-mappers.js";
export {
  createInMemorySsoStore, generateConfigInstanceId, publicConfig,
  SsoConfigConflictError, SsoConfigNotFoundError,
  type SsoCasExpectation, type SsoConfigWriteInput, type SsoStore, type StoredSsoConfig,
} from "./sso-store.js";
export { createPrismaSsoStore } from "./sso-prisma-store.js";
export { SsoErrors, signOidcToken, verifyOidcToken } from "./oidc-verifier.js";
export { exchangeAuthorizationCode, type OidcCodeExchange, type OidcCodeExchanger } from "./oidc-code-exchanger.js";
export { allowedJwksUrl, isLoopbackHost, JWKS_LIMITS, JWKS_SAFE_MESSAGE, JwksHostsSchema, loopbackAllowed } from "./jwks/policy.js";
export { MetricsRegistry, type MetricsSnapshot } from "./metrics.js";
export {
  RATE_LIMIT_RULES,
  RATE_WINDOW_MS,
  RateLimiter,
  type RateDecision,
} from "./rate-limit.js";
export {
  createRedisRateLimiter,
  type DistributedRateLimiter,
  type RateDecision as RedisRateDecision,
  type RedisOutagePolicy,
} from "./rate-limit-redis.js";
export {
  createRedisSseQuotaStore,
  type RedisSseQuotaOptions,
  type SseQuotaStore,
} from "./sse-quota-redis.js";
export {
  generateCheckpointMaterial,
  loadCheckpointMaterial,
  signCheckpoint,
  verifyCheckpoint,
  type AuditCheckpoint,
  type AuditCheckpointMaterial,
  type SignedAuditCheckpoint,
} from "./audit-checkpoint.js";
export {
  createStaticKeyProvider,
  openSecret,
  sealSecret,
  type KeyProvider,
  type SecretContext,
} from "./secret-envelope.js";
export {
  LOGIN_TRANSACTION_MS,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  hashOpaqueToken,
  hashesEqual,
  pkceChallenge,
  randomOpaqueToken,
} from "./session-security.js";
export {
  runRetentionSweep,
  type RetentionSweepPort,
  type RetentionSweepResult,
} from "./retention-sweeper.js";
export {
  OnboardingError,
  expiryFromNow,
  issueApiKey,
  onboardTenantInMemory,
  onboardTenantMemoryAtomic,
  validateOnboardingInput,
  onboardingAuditPayload,
  type OnboardingAuditSink,
  type OnboardingErrorCode,
  type OnboardingInput,
  type OnboardingResult,
  type OnboardingRollbackDeps,
  type OnboardingSecret,
  type OnboardingStoreDeps,
} from "./tenant-onboarding.js";
export { assertBootstrapAvailable, onboardTenantLive } from "./prisma-tenant-onboarding.js";
export { createPrismaTenantLifecycle } from "./prisma-tenant-lifecycle.js";
export { createPrismaDeletionOperationStore } from "./prisma-deletion-operations.js";
export {
  DeletionFlowError,
  confirmTenantDeletionFenced,
  fenceHashOf,
  type TenantDeletionFlowDeps,
} from "./tenant-deletion-operations.js";
export {
  TenantDeletionError,
  dryRunTenantDeletion,
  type TenantDeletionDryRun,
  type TenantDeletionErrorCode,
  type TenantDeletionDeps,
  type TenantDeletionReceipt,
} from "./tenant-deletion.js";
