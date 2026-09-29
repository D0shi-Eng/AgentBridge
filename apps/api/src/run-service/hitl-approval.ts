/**
 * تذاكر الموافقة البشرية HITL — عقد موافقة صريح موقّع.
 *
 * ماهيتها: تذكرة Ed25519 يصدرها الخادم من هوية مخولة (لا من العميل) تربط
 * قرار البشر بتشغيل محدد وبحالة محددة.
 * وظيفتها — شروط العقد:
 *   - مرتبطة بـrunId وtenantId وstage وبـsnapshotDigest (sha256 لنص
 *     snapshot الحالي) وبـartifactDigest — أي تغير لاحق في المخرجات يجعلها
 *     APPROVAL_STALE ولا تُقبل، فلا إعادة استخدام بعد تغير النتائج.
 *   - authorizationVersion الحالي يجب ألا يقل عن إصدار التذكرة — إبطال
 *     العضوية يقتل التذاكر (لا تجاوز بموافقة معطلة).
 *   - أحادية الاستخدام: jti يُستهلك ذرياً عبر ApprovalConsumedStore
 *     (Redis SETNX / خريطة عملية) — إعادة الاستخدام APPROVAL_REUSED.
 *   - لا تتجاوز فشلاً أمنياً حرجاً: البوابات تُعاد تنفيذاً عند الاستئناف —
 *     الموافقة تسمح بالاستمرار لا بتغيير حكم (مثبت اختبارياً في المحرك).
 * كيف: التوقيع على canonical JSON (نفس مبدأ snapshots)؛ التحقق دالة نقية
 * تعيد رموز رفض موحدة تبرمج عليها المسارات.
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { canonicalJson } from "@agentbridge/orchestrator";
import { AppError, err, ok, type Result } from "@agentbridge/shared";
import { z } from "zod";

export const HITL_APPROVAL_VERSION = 1;

/** عمر التذكرة الافتراضي — نافذة مراجعة بشرية معقولة */
export const HITL_APPROVAL_TTL_MS_DEFAULT = 24 * 60 * 60 * 1000;

export const HitlApprovalTicketSchema = z
  .object({
    version: z.literal(1),
    /** معرف أحادي الاستخدام — يستهلك عند أول استئناف ناجح التحقق */
    jti: z.string().min(8),
    runId: z.string().min(1),
    tenantId: z.string().min(1),
    /** المرحلة التي كانت في انتظار المراجعة */
    stage: z.string().min(1),
    /** sha256 لنص snapshot الموقّع وقت الموافقة */
    snapshotDigest: z.string().length(64),
    /** بصمة artifact وقت الموافقة أو "none" قبل توليده */
    artifactDigest: z.string(),
    approvedBy: z.string().min(1),
    authorizationVersion: z.number().int().nonnegative(),
    issuedAt: z.string(),
    expiresAt: z.string(),
  })
  .strict();

export type HitlApprovalTicket = z.infer<typeof HitlApprovalTicketSchema>;

export interface HitlApprovalEnvelope {
  readonly ticket: HitlApprovalTicket;
  readonly auth: { readonly alg: "Ed25519"; readonly keyId: string; readonly value: string };
}

/** مادة توقيع التذاكر — نفس primitive الشهادة؛ الإنتاج عبر إعداد الخادم */
export interface HitlSigningMaterial {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly keyId: string;
}

export function generateHitlSigningMaterial(): HitlSigningMaterial {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex").slice(0, 16);
  return { privateKey, publicKey, keyId };
}

/**
 * تحميل مادة توقيع HITL من إعداد الخادم (PKCS8 base64 Ed25519):
 * يلغي المفتاح العابر لكل عملية فيصح إصدار التذكرة في نسخة والتحقق بها
 * في نسخة أخرى (نشر متعدد النسخ). فشل التحميل يرفض الإقلاع — لا مفتاح
 * بديل صامت يخدع بمصداقية توقيع غير موجودة.
 */
export function loadHitlSigningMaterial(privatePkcs8Base64: string): Result<HitlSigningMaterial> {
  try {
    const privateKey = createPrivateKey({ key: Buffer.from(privatePkcs8Base64, "base64"), format: "der", type: "pkcs8" });
    if (privateKey.asymmetricKeyType !== "ed25519") {
      return err(new AppError("APPROVAL_KEY_INVALID", "مفتاح توقيع HITL يجب أن يكون Ed25519", false, "critical"));
    }
    const publicKey = createPublicKey(privateKey);
    const keyId = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex").slice(0, 16);
    return ok({ privateKey, publicKey, keyId });
  } catch {
    return err(new AppError("APPROVAL_KEY_INVALID", "تعذر تحميل مفتاح توقيع HITL — صيغة PKCS8 base64 لـEd25519 مطلوبة", false, "critical"));
  }
}

/** يصدر تذكرة موقعة — يُستدعى خادمياً حصراً من قرار مراجع بشري مخول */
export function signHitlApproval(input: {
  readonly ticket: Omit<HitlApprovalTicket, "version">;
  readonly material: HitlSigningMaterial;
}): string {
  const ticket: HitlApprovalTicket = { ...input.ticket, version: HITL_APPROVAL_VERSION };
  const parsed = HitlApprovalTicketSchema.safeParse(ticket);
  if (!parsed.success) {
    throw new AppError("APPROVAL_MALFORMED", `تذكرة HITL لا تطابق عقداها: ${parsed.error.issues.map((issue) => issue.path.join(".")).join("، ")}`);
  }
  const value = sign(null, Buffer.from(canonicalJson(ticket), "utf8"), input.material.privateKey);
  const envelope: HitlApprovalEnvelope = {
    ticket,
    auth: { alg: "Ed25519", keyId: input.material.keyId, value: value.toString("base64") },
  };
  return canonicalJson(envelope);
}

export interface ApprovalConsumedStore {
  /** يحاول استهلاك jti — true أول مرة (نجح)، false سبق استهلاكه */
  consume(jti: string): Promise<boolean>;
}

/** خريطة عملية واحدة — للاختبارات والتطوير؛ النشر متعدد النسخ يستخدم createRedisApprovalConsumedStore */
export function createInMemoryApprovalConsumedStore(): ApprovalConsumedStore {
  const consumed = new Set<string>();
  return {
    async consume(jti) {
      if (consumed.has(jti)) return false;
      consumed.add(jti);
      return true;
    },
  };
}

/** أصغر سطح Redis للاستهلاك الأحادي — SET NX PX ذرية فقط (نمط run-lock) */
export interface RedisSetNxCommands {
  set(key: string, value: string, options: { NX?: boolean; PX?: number }): Promise<string | null>;
}

/**
 * مخزن استهلاك أحادي مشترك فوق Redis SETNX: الذرية عبر النسخ —
 * jti يستهلك مرة واحدة مهما تنافست النسخ. فشل Redis يرمي (fail-closed):
 * لا موافقة تُقبل لمجرد تعطل المخزن المشترك. عمر العلامة يفوق عمر
 * التذكرة القصوى فلا يفتح انتهاؤه إعادة استخدام لتذكرة صالحة.
 */
export function createRedisApprovalConsumedStore(
  commands: RedisSetNxCommands,
  options: { readonly markerTtlMs: number },
): ApprovalConsumedStore {
  return {
    async consume(jti) {
      // مفتاح مبني من jti مرمّز — jti قد يحوي «:» فلا تصادم بنيوي بين المفاتيح
      const key = `hitl:consumed:${encodeURIComponent(jti)}`;
      const result = await commands.set(key, "1", { NX: true, PX: options.markerTtlMs });
      return result !== null;
    },
  };
}

/** مدخلات التحقق — كلها من مصادر موثوقة (principal المسار + snapshot المحملة) */
export interface VerifyHitlApprovalInput {
  readonly envelopeJson: string;
  readonly keyRing: ReadonlyMap<string, KeyObject>;
  readonly expected: {
    readonly runId: string;
    readonly tenantId: string;
    /** sha256 لنص snapshot الحالي المحمل من المخزن — تزداد التذكرة إن اختلفت */
    readonly snapshotDigest: string;
    /** بصمة artifact داخل snapshot الحالية */
    readonly artifactDigest: string;
    /** هوية صاحب الطلب الحالي — يجب أن تطابق هوية الموافق */
    readonly requesterSubjectId: string;
    /** إصدار التخويل الحالي من مصدر موثوق */
    readonly currentAuthorizationVersion: number;
    readonly now?: string;
  };
  readonly consumed: ApprovalConsumedStore;
}

/**
 * يتحقق كلياً ويستهلك jti ذرياً. رموز الرفض الموحدة:
 * APPROVAL_MALFORMED / APPROVAL_BAD_SIGNATURE / APPROVAL_UNKNOWN_KEY /
 * APPROVAL_MISMATCH (run/tenant/stage) / APPROVAL_STALE (snapshot/artifact
 * تغيرا) / APPROVAL_IDENTITY (مخالف للمُقدم) / APPROVAL_AUTHORIZATION_STALE /
 * APPROVAL_EXPIRED / APPROVAL_REUSED.
 */
export async function verifyHitlApproval(input: VerifyHitlApprovalInput): Promise<Result<HitlApprovalTicket>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.envelopeJson) as unknown;
  } catch {
    return err(new AppError("APPROVAL_MALFORMED", "تذكرة HITL ليست JSON صالحاً"));
  }
  const shape = HitlApprovalTicketSchema.safeParse((parsed as Record<string, unknown>)?.["ticket"]);
  const auth = (parsed as Record<string, unknown> | null)?.["auth"] as HitlApprovalEnvelope["auth"] | undefined;
  if (!shape.success || auth === undefined || auth.alg !== "Ed25519" || typeof auth.value !== "string") {
    return err(new AppError("APPROVAL_MALFORMED", "تذكرة HITL ناقصة أو مخالفة العقد"));
  }
  const ticket = shape.data;
  const publicKey = input.keyRing.get(auth.keyId);
  if (publicKey === undefined) {
    return err(new AppError("APPROVAL_UNKNOWN_KEY", `keyId غير معروف ${auth.keyId}`));
  }
  const signatureOk = verify(null, Buffer.from(canonicalJson(ticket), "utf8"), publicKey, Buffer.from(auth.value, "base64"));
  if (!signatureOk) {
    return err(new AppError("APPROVAL_BAD_SIGNATURE", "توقيع التذكرة لا يطابق محتواها"));
  }
  const expected = input.expected;
  if (ticket.runId !== expected.runId || ticket.tenantId !== expected.tenantId) {
    return err(new AppError("APPROVAL_MISMATCH", "التذكرة لتشغيل/مستأجر آخر"));
  }
  if (ticket.snapshotDigest !== expected.snapshotDigest || ticket.artifactDigest !== expected.artifactDigest) {
    return err(new AppError("APPROVAL_STALE", "تغيرت المخرجات بعد إصدار الموافقة — لا إعادة استخدام"));
  }
  if (ticket.approvedBy !== expected.requesterSubjectId) {
    return err(new AppError("APPROVAL_IDENTITY", "الموافقة صادرة عن هوية غير هوية مقدم الطلب"));
  }
  if (expected.currentAuthorizationVersion < ticket.authorizationVersion) {
    return err(new AppError("APPROVAL_AUTHORIZATION_STALE", "صلاحية الموافق أُبطلت بعد الإصدار"));
  }
  const now = expected.now ?? new Date().toISOString();
  if (Date.parse(ticket.expiresAt) <= Date.parse(now)) {
    return err(new AppError("APPROVAL_EXPIRED", "انتهت صلاحية الموافقة"));
  }
  if (!(await input.consumed.consume(ticket.jti))) {
    return err(new AppError("APPROVAL_REUSED", "التذكرة استُهلكت سابقاً — أحادية الاستخدام"));
  }
  return ok(ticket);
}

/** sha256 نص snapshot — بنفس حقيقة التذكرة */
export function digestOfSnapshot(snapshotJson: string): string {
  return createHash("sha256").update(snapshotJson).digest("hex");
}
