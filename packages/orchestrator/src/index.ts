/**
 * المنفذ العام لحزمة orchestrator — الرسم البياني والمحرك والاستئناف.
 *
 * المنسق حتمي 100% (صفر LLM فيه)؛ الوكلاء يُستدعى عبر عقد المراحل
 * ويخضع كل واحد لبوابات الحقيقة قبل دخول أي خرج للسياق.
 */

export {
  EXECUTION_ORDER,
  REPAIRABLE_STAGES,
  isRepairableStage,
  type NodeOutcome,
  type PipelineNode,
} from "./graph.js";
export {
  PipelineContext,
  validateSnapshotData,
  type PipelineData,
} from "./context-store.js";
export {
  canonicalJson,
  classifySnapshot,
  defaultProcessSigningMaterial,
  generateSnapshotSigningMaterial,
  loadSnapshotSigningMaterial,
  migrateLegacySnapshot,
  signSnapshot,
  verifySignedSnapshot,
  SIGNED_SNAPSHOT_VERSION,
  SNAPSHOT_POLICY_VERSION,
  SNAPSHOT_TTL_MS_DEFAULT,
  loadSnapshotVerifyKey,
  snapshotError,
  type SignedSnapshotEnvelope,
  type SignedSnapshotFacts,
  type SnapshotBodyFields,
  type SnapshotKeyRing,
  type SnapshotResumeBinding,
  type SnapshotSigningMaterial,
  type VerifySnapshotExpectations,
} from "./snapshot-signing.js";
export type { RepairRuntimeLimits } from "./contracts.js";
export { createEventLog, makeEvent, type EventLog, type EventListener } from "./event-log.js";
export {
  RETRY_DELAYS_MS,
  MAX_REPAIR_CYCLES,
  decideRetry,
  isTransientError,
  realSleep,
  type SleepFn,
  type FailureDecision,
} from "./retry-policy.js";
export {
  createMemorySnapshotStore,
  type OrchestratorOptions,
  type RunSummary,
  type SnapshotStore,
} from "./contracts.js";
export { PipelineOrchestrator } from "./engine.js";
export type { HardenOptions } from "./nodes/harden-node.js";
