/**
 * المنفذ العام لحزمة agents — الوكلاء الستة كاملين.
 *
 * كل وكيل يعيد Result ولا يرمي؛ مطالباته ملفات مستقلة قابلة للمراجعة،
 * وأدواته بعقد موحد (مدخل Zod ← تنفيذ حتمي ← مخرج Zod).
 */

export type { AgentTool, ToolContext } from "./tools/tool-contract.js";
export { validateToolInput } from "./tools/tool-contract.js";
export {
  createSearchSpecTool,
  SearchSpecInputSchema,
  type SearchMatch,
  type SearchSpecOutput,
} from "./tools/search-spec.js";
export {
  createGetEndpointDetailsTool,
  GetEndpointInputSchema,
  type EndpointDetailsOutput,
} from "./tools/get-endpoint-details.js";
export {
  createValidateToolDesignTool,
  checkToolDesign,
  ValidateDesignInputSchema,
  MAX_ENDPOINTS_PER_TOOL,
  type ValidateDesignOutput,
} from "./tools/validate-tool-design.js";

/* أدوات المدقق والمقيم والمصلح */
export {
  createReadArtifactSourceTool,
  ReadSourceInputSchema,
  createGrepArtifactTool,
  GrepInputSchema,
  GREP_MAX_HITS,
  type ReadSourceOutput,
  type GrepHit,
  type GrepOutput,
} from "./tools/artifact-inspection.js";
export {
  createRunSecuritySuiteTool,
  RunSuiteInputSchema,
  type RunSuiteOutput,
  type SuiteCheckSummary,
} from "./tools/security-suite-tool.js";
export {
  createSimulateToolCallTool,
  SimulateCallInputSchema,
  type SimulateCallOutput,
  type SimulationIssue,
} from "./tools/simulate-tool-call.js";
export {
  createApplyPatchTool,
  createRetestScopeTool,
  ApplyPatchInputSchema,
  RetestScopeInputSchema,
  type WorkingCopy,
  type ApplyPatchOutput,
  type RetestOutput,
} from "./tools/patch-tools.js";
export {
  enforcePatchPolicy,
  enforceRepairDeadline,
  isCanonicalArtifactPath,
  DEFAULT_REPAIR_PATCH_POLICY,
  type RepairPatchPolicy,
} from "./repair-policy.js";

/* مطالب النظام — ملفات مستقلة وفق وثيقة 09 */
export {
  DESIGNER_SYSTEM_PROMPT,
  buildSpecDigest,
  buildDesignerUserMessage,
} from "./prompts/designer-prompt.js";
export {
  AUDITOR_SYSTEM_PROMPT,
  buildFindingsDigest,
  buildAuditorUserMessage,
} from "./prompts/auditor-prompt.js";
export {
  EVALUATOR_SYSTEM_PROMPT,
  buildToolsDigest,
  buildEvaluatorUserMessage,
} from "./prompts/evaluator-prompt.js";
export {
  REPAIRER_SYSTEM_PROMPT,
  buildFailureDigest,
  buildFilesDigest,
  buildRepairerUserMessage,
} from "./prompts/repairer-prompt.js";

/* الوكلاء */
export {
  DesignerAgent,
  MAX_DESIGN_ROUNDS,
  type DesignPhaseInput,
  type DesignPhaseResult,
  type DesignerOutput,
} from "./designer-agent.js";
export {
  AuditorAgent,
  checkCoverage,
  MAX_AUDIT_ROUNDS,
  type AuditPhaseInput,
  type AuditPhaseResult,
  type AuditorOutput,
} from "./auditor-agent.js";
export {
  EvaluatorAgent,
  checkScoreCoverage,
  MAX_EVALUATION_ROUNDS,
  type EvaluationPhaseInput,
  type EvaluationPhaseResult,
  type EvaluatorOutput,
} from "./evaluator-agent.js";
export {
  RepairerAgent,
  validatePatch,
  MAX_TOUCHED_FILES_RATIO,
  type RepairPhaseInput,
  type RepairerOutput,
} from "./repairer-agent.js";

export { AgentsErrors } from "./errors.js";
