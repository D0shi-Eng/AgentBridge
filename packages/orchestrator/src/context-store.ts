/**
 * مخزن السياق — حالة التشغيل القابلة للتسلسل والاستئناف (وثيقة 09).
 *
 * كل مخرجات المراحل تُحفظ هنا، وبعد اكتمال كل عقدة يُلتقط snapshot
 * موقّع ببصمة SHA-256. انهيار العملية في أي لحظة؟ الاستئناف يعيد
 * قراءة آخر snapshot ويتحقق من سلامته ثم يواصل من أول عقدة غير مكتملة.
 *
 * idempotency العقدة مضمون بنيوياً: العقدة تعتمد مدخلاتها من السياق فقط،
 * وإعادة تنفيذها على نفس السياق تنتج نفس المخرجات.
 */

import { createHash } from "node:crypto";
import {
  StageIds,
  StageStatus,
  Errors,
  err,
  ok,
  AnalyzedSpecSchema,
  AuditedFindingSchema,
  CertificateSchema,
  GeneratedServerArtifactSchema,
  LiveProbeEvidenceSchema,
  NormalizedSpecSchema,
  QualityScoreSchema,
  SecurityReportSchema,
  ToolDesignSchema,
  type Certificate,
  type AuditedFinding,
  type GeneratedServerArtifact,
  type LiveProbeEvidence,
  type NormalizedSpec,
  type AnalyzedSpec,
  type QualityScore,
  type Result,
  type SecurityReport,
  type StageId,
  type ToolDesign,
} from "@agentbridge/shared";
import { z, type ZodType } from "zod";
import { signSnapshot, verifySignedSnapshot, SNAPSHOT_POLICY_VERSION, type SnapshotKeyRing, type SnapshotResumeBinding, type SnapshotSigningMaterial, type VerifySnapshotExpectations } from "./snapshot-signing.js";
import { SandboxAttestationSchema } from "./nodes/sandbox-probes.js";

/** بيانات التشغيل المتراكمة عبر المراحل — كل حقولها قابلة للتسلسل JSON */
export interface PipelineData {
  rawSpec?: string;
  normalized?: NormalizedSpec;
  analyzed?: AnalyzedSpec;
  designs?: ToolDesign[];
  artifact?: GeneratedServerArtifact;
  securityReport?: SecurityReport;
  auditedFindings?: readonly AuditedFinding[];
  qualityScores?: readonly QualityScore[];
  certificate?: Certificate;
  /** دليل الفئات الحية من harden — بوابة المنح في certify */
  liveProbeEvidence?: LiveProbeEvidence;
  /** إثبات بيئة sandbox للفحوص الحية — يرافق الدليل في L1/L2 */
  liveProbeRun?: {
    checksTotal: number;
    checksPassed: number;
    probedArtifactsHash: string;
    executedAt: string;
    sandbox: import("./nodes/sandbox-probes.js").SandboxAttestation;
  };
}

const SNAPSHOT_VERSION = 1;

export { SNAPSHOT_VERSION as PIPELINE_SNAPSHOT_BODY_VERSION };

/**
 * مخططات حقول data المعروفة — أي حقل عابر
 * يتحقق مخططياً قبل الثقة به، وأي حقل غير معروف يُرفض (لا تهريب بيانات
 * عبر snapshot مصطنعة حتى لو طُبئت بصمتها).
 */
const DATA_FIELD_SCHEMAS: Readonly<Record<string, ZodType>> = {
  rawSpec: z.string(),
  normalized: NormalizedSpecSchema,
  analyzed: AnalyzedSpecSchema,
  designs: z.array(ToolDesignSchema),
  artifact: GeneratedServerArtifactSchema,
  securityReport: SecurityReportSchema,
  auditedFindings: z.array(AuditedFindingSchema),
  qualityScores: z.array(QualityScoreSchema),
  certificate: CertificateSchema,
  liveProbeEvidence: LiveProbeEvidenceSchema,
  /** إثبات بيئة sandbox للفحوص الحية — يرافق الدليل في L1/L2 */
  liveProbeRun: LiveProbeEvidenceSchema.extend({ sandbox: SandboxAttestationSchema }),
};

const SnapshotShape = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  tenantId: z.string().min(1),
  createdAt: z.string(),
  statuses: z.record(z.enum(StageIds), StageStatus),
  repairCyclesUsed: z.number().int().nonnegative(),
  data: z.record(z.string(), z.unknown()),
});

/** يتحقق من حقول data ضد المخططات المعروفة — يشاركه مسار التوقيع (snapshot-signing) */
export function validateSnapshotData(data: Record<string, unknown>): Result<void> {
  for (const [field, value] of Object.entries(data)) {
    const schema = DATA_FIELD_SCHEMAS[field];
    if (schema === undefined) {
      return err(Errors.invalidInput(`snapshot يحمل حقل data غير معروف: ${field} — رُفض`));
    }
    if (!schema.safeParse(value).success) {
      return err(Errors.invalidInput(`حقل snapshot «${field}» لا يطابق مخططه الموثق — رُفض`));
    }
  }
  return ok(undefined);
}

export interface PipelineSnapshotBody {
  readonly version: typeof SNAPSHOT_VERSION;
  readonly runId: string;
  readonly tenantId: string;
  readonly createdAt: string;
  readonly statuses: Record<string, string>;
  readonly repairCyclesUsed: number;
  readonly data: Record<string, unknown>;
}

/** البصمة الحتمية لجسم الsnapshot — أي عبث يُكتشف عند الاستئناف */
function integrityOf(body: PipelineSnapshotBody): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export class PipelineContext {
  readonly runId: string;
  readonly tenantId: string;
  readonly data: PipelineData = {};
  readonly statuses = new Map<StageId, StageStatus>();
  repairCyclesUsed = 0;
  /** تسلسل تصاعدي لكل save — يوقّع في facts ويرفض replay بإصدار أقدم */
  generation = 0;

  constructor(runId: string, tenantId: string) {
    this.runId = runId;
    this.tenantId = tenantId;
    for (const stage of StageIds) this.statuses.set(stage, "pending");
  }

  setStatus(stage: StageId, status: StageStatus): void {
    this.statuses.set(stage, status);
  }

  completedStages(): readonly StageId[] {
    return StageIds.filter((stage) => this.statuses.get(stage) === "completed");
  }

  firstNonCompleted(): StageId | undefined {
    return StageIds.find((stage) => this.statuses.get(stage) !== "completed");
  }

  /** يلتقط snapshot موقعة بصمةً — نص JSON جاهز للحفظ في أي مخزن */
  toSnapshot(): string {
    const body: PipelineSnapshotBody = {
      version: SNAPSHOT_VERSION,
      runId: this.runId,
      tenantId: this.tenantId,
      createdAt: new Date().toISOString(),
      statuses: Object.fromEntries(this.statuses),
      repairCyclesUsed: this.repairCyclesUsed,
      data: this.data as unknown as Record<string, unknown>,
    };
    return JSON.stringify({ ...body, integrity: integrityOf(body) });
  }

  /** يعيد بناء سياق من snapshot بعد التحقق من الشكل والبصمة — مسار legacy v1 فقط */
  static fromSnapshot(json: string): Result<PipelineContext> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json) as unknown;
    } catch {
      return err(Errors.invalidInput("snapshot ليس JSON صالحاً"));
    }
    if (parsed === null || typeof parsed !== "object") {
      return err(Errors.invalidInput("snapshot ليس كائناً صالحاً"));
    }
    const record = parsed as Record<string, unknown>;

    // z.object غير الصارم يتجاهل حقل integrity الزائد ويتحقق من البنية
    const shape = SnapshotShape.safeParse(record);
    if (!shape.success) {
      return err(Errors.invalidInput(`snapshot لا يطابق عقد الإصدار ${SNAPSHOT_VERSION}`));
    }
    const body = shape.data as unknown as PipelineSnapshotBody;
    if (integrityOf(body) !== record["integrity"]) {
      return err(Errors.invalidInput("بصمة snapshot لا تطابق محتواها — احتمال عبث أو تلف"));
    }

    const context = new PipelineContext(body.runId, body.tenantId);
    for (const [stage, status] of Object.entries(body.statuses)) {
      context.statuses.set(stage as StageId, status as StageStatus);
    }
    context.repairCyclesUsed = body.repairCyclesUsed;

    // التحقق المخططي لكل حقل عابر — لا ثقة عمياء بما خرج من العملية (القاعدة 16)
    for (const [field, value] of Object.entries(body.data)) {
      const schema = DATA_FIELD_SCHEMAS[field];
      if (schema === undefined) {
        return err(Errors.invalidInput(`snapshot يحمل حقل data غير معروف: ${field} — رُفض`));
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        return err(Errors.invalidInput(`حقل snapshot «${field}» لا يطابق مخططه الموثق — رُفض`));
      }
      (context.data as Record<string, unknown>)[field] = parsed.data;
    }
    return ok(context);
  }

  /** جسم snapshot الداخلي كما يدخل المظروف الموقّع — بلا توقيع */
  snapshotBody(): {
    version: 1; runId: string; tenantId: string; createdAt: string;
    statuses: Record<string, string>; repairCyclesUsed: number; data: Record<string, unknown>;
  } {
    return {
      version: 1,
      runId: this.runId,
      tenantId: this.tenantId,
      createdAt: new Date().toISOString(),
      statuses: Object.fromEntries(this.statuses),
      repairCyclesUsed: this.repairCyclesUsed,
      data: this.data as unknown as Record<string, unknown>,
    };
  }

  /**
   * مظروف snapshot الموقّع — الإصدار الذي يخزنه المحرك في L1/L2.
   * البصمة المجردة القديمة (toSnapshot) بقيت للاختبارات والتوافق الداخلي فقط
   * ولا تُقبل للاستئناف (تصنيف legacy يحجرها).
   */
  toSignedSnapshot(input: {
    readonly material: SnapshotSigningMaterial;
    readonly resumeBinding: SnapshotResumeBinding;
    readonly inputDigests: Readonly<Record<string, string>>;
    readonly ttlMs?: number;
    readonly now?: string;
  }): string {
    this.generation += 1;
    return signSnapshot({
      facts: {
        runId: this.runId,
        tenantId: this.tenantId,
        createdAt: input.now ?? new Date().toISOString(),
        generation: this.generation,
        policyVersion: SNAPSHOT_POLICY_VERSION,
        resumeBinding: input.resumeBinding,
        inputDigests: input.inputDigests,
      },
      payload: this.snapshotBody(),
      material: input.material,
      now: input.now,
      ...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
    });
  }

  /** إعادة بناء سياق من payload موقعة التحقق — بدون إعادة فحص التوقيع (تم أعلاه) */
  static fromVerifiedPayload(
    runId: string,
    tenantId: string,
    body: { statuses: Record<string, string>; repairCyclesUsed: number; data: Record<string, unknown> },
  ): Result<PipelineContext> {
    const context = new PipelineContext(runId, tenantId);
    for (const [stage, status] of Object.entries(body.statuses)) {
      context.statuses.set(stage as StageId, status as StageStatus);
    }
    context.repairCyclesUsed = body.repairCyclesUsed;
    for (const [field, value] of Object.entries(body.data)) {
      const schema = DATA_FIELD_SCHEMAS[field];
      if (schema === undefined) {
        return err(Errors.invalidInput(`snapshot يحمل حقل data غير معروف: ${field} — رُفض`));
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        return err(Errors.invalidInput(`حقل snapshot «${field}» لا يطابق مخططه الموثق — رُفض`));
      }
      (context.data as Record<string, unknown>)[field] = parsed.data;
    }
    return ok(context);
  }

  /** مسار التحقق الكامل للمظروف الموقّع — يفوض snapshot-signing ويعيد السياق جاهزاً */
  static fromSignedSnapshot(
    envelopeJson: string,
    keyRing: SnapshotKeyRing,
    expected: VerifySnapshotExpectations,
  ): Result<PipelineContext> {
    const verified = verifySignedSnapshot(envelopeJson, keyRing, expected);
    if (!verified.ok) return verified;
    const built = PipelineContext.fromVerifiedPayload(verified.value.payload.runId, verified.value.payload.tenantId, verified.value.payload);
    if (built.ok) built.value.generation = verified.value.facts.generation;
    return built;
  }
}
