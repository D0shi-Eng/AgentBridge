/**
 * المنفذ العام لحزمة memory — طبقات الذاكرة الأربع بمنافذها (وثيقة 07).
 *
 * L0 ذاكرة العمل = PipelineContext في orchestrator (لا شيء هنا).
 * L1 العرضية و L2 الدلالية و L3 المتجهية بمنافذها ومحولاتها داخل الذاكرة.
 * المحولات التقنية (Redis/pgvector) في packages/infra تطابق هذه
 * المنافذ بنيوياً — التبديل لا يمس أي مستهلك.
 * L4 دولاب التعلم مؤجل موثقاً حتى تتعدد التشغيلات الفعلية.
 */

export {
  createInMemoryEpisodicStore,
  type EpisodicStore,
  type InMemoryEpisodicOptions,
} from "./episodic-store.js";
export {
  createInMemorySemanticStore,
  createSemanticCollections,
  type InMemorySemanticStore,
  type SemanticCollections,
  type ArtifactRecord,
  type AuditSink,
  type CertificateRecord,
  type CertificateRevocationRecord,
  type PipelineRecord,
  type ProjectRecord,
  type SemanticStore,
  type SpecRecord,
  type TenantRecord,
} from "./semantic-store.js";
export {
  EMBEDDING_DIMS,
  EMBEDDING_VERSION,
  VECTOR_PROVENANCE_KEYS,
  cosine,
  embedText,
  createInMemoryVectorStore,
  type VectorDocument,
  type VectorHit,
  type VectorNamespace,
  type VectorStore,
} from "./vector-store.js";
export { LessonSchema, createInMemoryFlywheelStore, type FlywheelAnalytics, type FlywheelRange, type FlywheelStore, type Lesson } from "./flywheel.js";
export type {
  ApiCredentialRecord,
  AuthStore,
  ExternalIdentityRecord,
  InternalMembershipRecord,
  LoginTransactionRecord,
  MembershipRecord,
  SessionRecord,
} from "./auth-contracts.js";
export { internalIdentityId, internalMembershipId } from "./auth-contracts.js";
export { createInMemoryAuthStore, createAuthCollections, type AuthCollections, type InMemoryAuthStore } from "./in-memory-auth-store.js";
export {
  semanticLifecycleOver,
  authLifecycleOver,
  type TenantDeletionImpact,
  type SweepClassResult,
  type SemanticTenantLifecycle,
  type AuthTenantLifecycle,
  type TenantLifecycleStore,
} from "./tenant-lifecycle.js";
export {
  createInMemoryRunArchiveStore,
  staleArchiveError,
  createFencedSnapshotSave,
  type RunArchiveRecord,
  type RunArchiveStore,
} from "./run-archive.js";
export {
  createInMemoryDeletionOperationStore,
  type DeletionAuditEntryInput,
  type DeletionClaimOutcome,
  type DeletionOperationStage,
  type DeletionOperationStatus,
  type DeletionOperationStore,
  type TenantDeletionOperationRecord,
} from "./deletion-operations.js";
export { TOMBSTONE_NAME, TOMBSTONE_HASH } from "./tenant-lifecycle.js";
export type { InMemoryTenantOps } from "./semantic-store.js";
export type { InMemoryIdentityOps } from "./in-memory-auth-store.js";
