/**
 * سجل التدقيق append-only بسلسلة hash (وثيقة security.md §7).
 *
 * القاعدة الملزمة: hash_n = sha256(prevHash + canonical(حقول الصف))،
 * وأول صف لكل مستأجر يبدأ من بذرة GENESIS. أي عبث في صف واحد يكسر
 * كل السلسلة بعده ويكشفه verifyChain.
 *
 * الخدمة تعيش في infra لأنها حوكمة بنية تحتية، لكنها تكتب عبر منفذ
 * AuditSink الضيق (مطابق بنيوياً لSemanticStore في memory) فلا تعرف
 * شيئاً عن قاعدة البيانات الفعلية. كل حدث أنبوب وكل قرار بوابة
 * يُرحَّل إليها عبر onEvent في run-service.
 */

import {
  AUDIT_GENESIS_HASH,
  AuditTrailEntrySchema,
  Errors,
  err,
  ok,
  type AuditStage,
  type AuditTrailEntry,
  type Result,
} from "@agentbridge/shared";
import { sha256Hex, stableStringify } from "./crypto.js";

export interface AuditRecordInput {
  readonly tenantId: string;
  readonly runId: string;
  readonly stage: AuditStage;
  /** حالة المرحلة الجديدة أو "event" للأحداث غير الحالة */
  readonly decision: string;
  /** ملخص مجرد بلا PII وبلا أسرار — نقيّته مسؤولية المستدعي */
  readonly abstractedPayload: string;
  readonly at: string;
}

/** البصمة الحتمية لصف تدقيق — الحقول الثمانية فقط دون hash نفسه */
export function computeAuditHash(entry: AuditTrailEntry): string {
  return sha256Hex(
    entry.prevHash +
      stableStringify({
        seq: entry.seq,
        tenantId: entry.tenantId,
        runId: entry.runId,
        stage: entry.stage,
        decision: entry.decision,
        abstractedPayload: entry.abstractedPayload,
        at: entry.at,
        prevHash: entry.prevHash,
      }),
  );
}

export interface AuditSinkPort {
  lastAuditEntry(tenantId: string): Promise<AuditTrailEntry | null>;
  appendAuditEntry(entry: AuditTrailEntry): Promise<void>;
  listAuditEntries(tenantId: string): Promise<readonly AuditTrailEntry[]>;
}

/**
 * يبني صفاً موصولاً بذيل السلسلة بلا كتابة — يُستخدم حيث يجب أن يولد
 * الوصل ويُكتب داخل معاملة خارجية واحدة (onboarding الحي وحذف المستأجر
 * الحي) كي لا يصبح القرار فعالاً قبل نجاح التدقيق.
 */
export function buildChainedAuditEntry(input: AuditRecordInput, tail: AuditTrailEntry | null): AuditTrailEntry {
  const seq = (tail?.seq ?? 0) + 1;
  const prevHash = tail?.hash ?? AUDIT_GENESIS_HASH;
  const candidate: AuditTrailEntry = { ...input, seq, prevHash, hash: "" };
  return { ...candidate, hash: computeAuditHash(candidate) };
}

/** يكتشف تعارض الكتابة الفريد (P2002 أو رسالة Unique) — إشارة إعادة محاولة لا فشل نهائي */
function isUniqueConstraintConflict(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code === "P2002") return true;
  return /unique constraint|P2002/iu.test(String((error as Error)?.message ?? ""));
}

export class HashChainAuditLog {
  /** ذيل السلسلة لكل مستأجر — يوفر قراءة lastAuditEntry المتكررة */
  private readonly tails = new Map<string, AuditTrailEntry>();
  /**
   * طابور إلحاق لكل مستأجر — الأحداث تصل من onEvent بلا تنسيق زمني
   * بينها، وهذه الطابور يضمن قراءة الذيل والإلحاق بترتيب صارم
   * فلا تتكرر seq ولا تتشعب السلسلة تحت التزامن.
   */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly sink: AuditSinkPort) {}

  /**
   * يلحق صفاً جديداً موصولاً بذيل سلسلة المستأجر ويعيده.
   * تنافس العمليات — عملية أخرى قد تستولي على seq بين قراءة
   * الذيل والكتابة (رفض unique في القاعدة). الفقد الصامت ممنوع: عند
   * تعارض كتابة يعاد قراءة الذيل من القاعدة وإعادة بناء الصف وإعادة
   * الإلحاق بحد أقصى 5 محاولات — لا صف يضيع ولا فجوة في السلسلة.
   */
  async record(input: AuditRecordInput): Promise<AuditTrailEntry> {
    const previous = this.queues.get(input.tenantId) ?? Promise.resolve();
    const task = previous.then(async () => {
      let tail = this.tails.get(input.tenantId) ?? (await this.sink.lastAuditEntry(input.tenantId));
      // 20 محاولة: مطاردة الذيل بين عمليتين سريعتين قد تتعارض عدة مرات متتالية
      // (كل إعادة محاولة تقع على seq العملية الأخرى الجديد) — الحد محدود وثابت
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const seq = (tail?.seq ?? 0) + 1;
        const prevHash = tail?.hash ?? AUDIT_GENESIS_HASH;
        const candidate: AuditTrailEntry = { ...input, seq, prevHash, hash: "" };
        const entry: AuditTrailEntry = { ...candidate, hash: computeAuditHash(candidate) };
        try {
          await this.sink.appendAuditEntry(entry);
          this.tails.set(input.tenantId, entry);
          return entry;
        } catch (error) {
          // تعارض seq مع عملية أخرى (P2002) — الذيل المحلي قديم: أعد قراءته
          if (!isUniqueConstraintConflict(error)) throw error;
          tail = await this.sink.lastAuditEntry(input.tenantId);
        }
      }
      throw Errors.internal("فشل إلحاق حدث التدقيق بعد 20 محاولة ضد تعارضات الكتابة المتزامنة");
    });
    // الفشل لا يوقف السلسلة للحدث التالي؛ الخطأ ينتشر لمستدعي الحدث الحالي فقط
    this.queues.set(input.tenantId, task.catch(() => undefined));
    return task;
  }

  /**
   * يعيد بناء السلسلة كاملة للمستأجر: تسلسل الأرقام، الوصل بالسابق،
   * وإعادة حساب كل hash. أول خلل يعاد بموضعه الدقيق.
   */
  async verifyChain(tenantId: string): Promise<Result<{ entries: number }>> {
    const entries = await this.sink.listAuditEntries(tenantId);
    let expectedPrev = AUDIT_GENESIS_HASH;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index] as AuditTrailEntry;
      if (!AuditTrailEntrySchema.safeParse(entry).success) {
        return err(Errors.invalidInput(`صف تدقيق غير سليم البنية عند الموضع ${index + 1}`));
      }
      if (entry.seq !== index + 1 || entry.prevHash !== expectedPrev || computeAuditHash(entry) !== entry.hash) {
        return err(Errors.internal(`سلسلة تدقيق مكسورة عند الصف ${index + 1} — احتمال عبث`));
      }
      expectedPrev = entry.hash;
    }
    return ok({ entries: entries.length });
  }
}
