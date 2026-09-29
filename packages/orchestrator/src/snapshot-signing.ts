/**
 * مصادقة snapshots: استبدال الاعتماد على SHA-256 المجردة
 * بتوقيع Ed25519 مفتاحي فوق مظروف صريح البنية.
 *
 * ماهيتها: طبقة توقيع/تحقق مستقلة عن مخزن السياق — لا تغير بيانات الـsnapshot
 * نفسها بل تلفها بمظروف موقّع.
 * وظيفتها:
 *   1. serialization حتمي موثق (canonicalJson) — التوقيع لا يعتمد على ترتيب
 *      مفاتيح JSON عرضياً: مفاتيح الكائنات تُرتب معجمياً بشكل تكراري.
 *   2. توقيع المظروف بمفتاح Ed25519 (نفس primitive توقيع الشهادات) مع keyId
 *      يسمح بدوران المفاتيح (التحقق بمفتاح قديم للقراءة فقط أثناء التدوير).
 *   3. تحقق صريح بالحالة قبل أي استخدام: التوقيع، المفتاح معروف، غير منتهية،
 *      ربط الهوية (runId/tenantId/المُستأنف/إصدار التخويل) — وجود القيم داخل
 *      الsnapshot لا يثبت مطابقتها؛ المصدر الموثوق هو Principal مسار التشغيل.
 *   4. تصنيف الإصدار 1 (legacy) حجراً QUARANTINED — لا قبول بصمت؛ هجرته
 *      مصرحة تتطلب authorizedBy وتُعيد التوقيع بعلامة ترقية الثقة المحدودة.
 * كيف: دوال نقية فوق node:crypto؛ كل رفض يخرج AppError برمز ثابت قابل
 * للبرمجة عليه لا رسائل غامضة (شرط القبول: رموز موحدة).
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify as verifySignature, type KeyObject } from "node:crypto";
import { AppError, err, ok, type Result } from "@agentbridge/shared";

/** إصدار المظروف الموقّع — يُرفض أي غيره صراحة (لا توافق صامتة) */
export const SIGNED_SNAPSHOT_VERSION = 2;

/** نافذة صلاحية snapshot الافتراضية — مواءمة TTL الـL1 (وثيقة 05 §1) */
export const SNAPSHOT_TTL_MS_DEFAULT = 7 * 24 * 60 * 60 * 1000;

/** إصدار سياسة snapshot الحالي — تغييره يرفض snapshots سياسة أقدم */
export const SNAPSHOT_POLICY_VERSION = "snapshot-policy-1";

/** خطأ snapshot برمز ثابت — كل رمز يبرمج عليه مسار الرفض في الطبقات الأعلى */
export function snapshotError(code: string, message: string): AppError {
  return new AppError(code, message, false, "critical");
}

/**
 * serialization حتمي: الكائنات مفاتيحها مرتبة معجمياً بشكل تكراري، المصفوفات
 * بترتيبها، بلا فراغات. هذا هو «التسلسل الحتمي الموثق» المعلن — لا اعتماد
 * على ترتيب JSON عرضياً في أي توقيع هنا.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** مادة مفتاح التوقيع — الخاص للتوقيع فقط، العام للتتحقق في أي عملية */
export interface SnapshotSigningMaterial {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  /** sha256(SPKI) مقطعاً — يسمح بدوران المفاتيح بمطابقة keyId لا بالتخمين */
  readonly keyId: string;
}

function keyIdOf(publicKey: KeyObject): string {
  return createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex").slice(0, 16);
}

function assertEd25519(key: KeyObject, label: string): void {
  if (key.asymmetricKeyType !== "ed25519") {
    throw snapshotError("SNAPSHOT_KEY_INVALID", `مفتاح ${label} ليس Ed25519 — رُفض (السياسة خوارزمية وحيدة)`);
  }
}

/** يولد ثنائية مفاتيح جديدة — للاختبارات والتدوير؛ الإنتاج يحمل الخاص عبر إعداد Zod */
export function generateSnapshotSigningMaterial(): SnapshotSigningMaterial {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKey, keyId: keyIdOf(publicKey) };
}

/** يحمّل مادة التوقيع من PKCS8 base64 (من إعداد الخادم الموثوق حصراً) */
export function loadSnapshotSigningMaterial(privatePkcs8Base64: string): Result<SnapshotSigningMaterial> {
  try {
    // صيغة DER المصرح بها صراحة — الاكتشاف التلقائي يفشل على بعض منصات OpenSSL
    const privateKey = createPrivateKey({ key: Buffer.from(privatePkcs8Base64, "base64"), format: "der", type: "pkcs8" });
    assertEd25519(privateKey, "خاص");
    const publicKey = createPublicKey(privateKey);
    return ok({ privateKey, publicKey, keyId: keyIdOf(publicKey) });
  } catch {
    return err(snapshotError("SNAPSHOT_KEY_INVALID", "تعذر تحميل مفتاح توقيع snapshot — صيغة PKCS8 base64 لـEd25519 مطلوبة"));
  }
}

/**
 * مفتاح تحقق عام فقط من SPKI base64 (نافذة الدوران): يدخل حلقة
 * التحقق ولا يصدر به أبداً — التدوير = إصدار بالمفتاح الجديد وقبول قراءة
 * بالقديم حتى انتهاء صلاحية ما وقّع به، بلا تمديد صامت لأي صلاحية.
 */
export function loadSnapshotVerifyKey(publicSpkiBase64: string): Result<{ readonly keyId: string; readonly publicKey: KeyObject }> {
  try {
    const publicKey = createPublicKey({ key: Buffer.from(publicSpkiBase64, "base64"), format: "der", type: "spki" });
    assertEd25519(publicKey, "عام");
    return ok({ keyId: keyIdOf(publicKey), publicKey });
  } catch {
    return err(snapshotError("SNAPSHOT_KEY_INVALID", "تعذر تحميل مفتاح تحقق snapshot — صيغة SPKI base64 لـEd25519 مطلوبة"));
  }
}

/**
 * مفتاح عابر واحد لكل عملية — الافتراضي للتطوير والاختبار داخل عملية واحدة.
 * قرار موثق: هذا **ليس** مفتاح إنتاج؛ الاستئناف بين عمليات (restart API)
 * يستلزم مفتاح إعداد الخادم الموثوق عبر ORCH_SNAPSHOT_PRIVATE_KEY — بقيادة
 * container الـAPI. المهم أمنياً: حتى العابر ليس مشتقاً من محتوى الحالة
 * (مصادقة حقيقية لا بصمة مجردة).
 */
let processWideMaterial: SnapshotSigningMaterial | undefined;
export function defaultProcessSigningMaterial(): SnapshotSigningMaterial {
  processWideMaterial ??= generateSnapshotSigningMaterial();
  return processWideMaterial;
}

/** خارطة keyId → مفتاح عام — أساس الدوران: التحقق بأي مفتاح معروف، الإصدار بالحالي */
export type SnapshotKeyRing = ReadonlyMap<string, KeyObject>;

/** ربط هوية الاستئناف الموقّع داخل الpayload — من يحق له الاستئناف وما أدنى إصدار تخويل */
export interface SnapshotResumeBinding {
  /** subjectIds المسموح لهم الاستئناف؛ فارغة = service داخلي فقط (لا مستخدم) */
  readonly allowedSubjects: readonly string[];
  /** أدنى authorizationVersion مقبول — يمنع استعادة صلاحيات مبطلة */
  readonly minAuthorizationVersion: number;
}

/** ختم الحقائق الملزمة التي يحميها التوقيع (أمر البرومبت §6 — كلها داخل المحتوى المحمي) */
export interface SignedSnapshotFacts {
  readonly runId: string;
  readonly tenantId: string;
  /** لحظة الإنشاء ISO */
  readonly createdAt: string;
  /** لحظة انتهاء الصلاحية ISO وفق السياسة */
  readonly expiresAt: string;
  /** تسلسل تصاعدي لكل save — أساس حرس replay (رفض إصدار أقدم من المرئي) */
  readonly generation: number;
  readonly policyVersion: string;
  readonly resumeBinding: SnapshotResumeBinding;
  /** بصمات المدخلات والـartifact عند توفرها — تربط الحالة بمدخلاتها */
  readonly inputDigests: Readonly<Record<string, string>>;
  /** علامة هجرة legacy مصرحة — دائماً موجودة في المهاجرة وغائبة في الأصلية */
  readonly migratedFrom?: 1;
}

/** جسم snapshot الداخلي كما ينتجه مخزن السياق (يُتحقق مخططياً هناك) */
export interface SnapshotBodyFields {
  readonly version: number;
  readonly runId: string;
  readonly tenantId: string;
  readonly createdAt: string;
  readonly statuses: Record<string, string>;
  readonly repairCyclesUsed: number;
  readonly data: Record<string, unknown>;
}

/** المظروف الكامل كما يُخزن في L1/L2 */
export interface SignedSnapshotEnvelope {
  readonly snapshotVersion: typeof SIGNED_SNAPSHOT_VERSION;
  readonly facts: SignedSnapshotFacts;
  readonly payload: SnapshotBodyFields;
  readonly auth: {
    readonly alg: "Ed25519";
    readonly keyId: string;
    readonly signedAt: string;
    readonly value: string;
  };
}

const AUTH_ALG = "Ed25519";

/** نص موقّع = canonical(facts + payload) حصراً — أي مساس بأحدهما يكسر التوقيع */
function signingInput(facts: SignedSnapshotFacts, payload: SnapshotBodyFields): Buffer {
  return Buffer.from(canonicalJson({ facts, payload }), "utf8");
}

/** يوقع جسم snapshot ويخرج نص المظروف الجاهز للتخزين */
export function signSnapshot(input: {
  readonly facts: Omit<SignedSnapshotFacts, "expiresAt">;
  readonly payload: SnapshotBodyFields;
  readonly material: SnapshotSigningMaterial;
  readonly now?: string;
  /** نافذة الصلاحية بالمللي — تُختم داخل facts ويوقّع معها كاملة
   * (signingInput يوقع facts بما فيها expiresAt، فلا تمديد صامت ممكن بنيوياً) */
  readonly ttlMs?: number;
}): string {
  const now = input.now ?? new Date().toISOString();
  const ttlMs = input.ttlMs ?? SNAPSHOT_TTL_MS_DEFAULT;
  const facts: SignedSnapshotFacts = { ...input.facts, expiresAt: new Date(Date.parse(now) + ttlMs).toISOString() };
  const signature = sign(null, signingInput(facts, input.payload), input.material.privateKey);
  const envelope: SignedSnapshotEnvelope = {
    snapshotVersion: SIGNED_SNAPSHOT_VERSION,
    facts,
    payload: input.payload,
    auth: { alg: AUTH_ALG, keyId: input.material.keyId, signedAt: now, value: signature.toString("base64") },
  };
  return canonicalJson(envelope);
}

/** خيارات التحقق — كل ما يأتي من Principal موثوق ومسار التشغيل المخول */
export interface VerifySnapshotExpectations {
  /** اختياري للمسار القرائي فقط — مسار الاستئناف يمرره إلزامياً */
  readonly runId?: string;
  /** اختياري للمسار القرائي فقط — مسار الاستئناف يمرره إلزامياً */
  readonly tenantId?: string;
  /** subjectId المُستأنف — يطابق allowedSubjects عندما تكون غير فارغة */
  readonly resumerSubject?: string;
  /** إصدار التخويل الحالي من مصدر موثوق (لا من snapshot) */
  readonly authorizationVersion?: number;
  readonly policyVersion?: string;
  readonly now?: string;
  /** أدنى generation مقبول — من الأرشيف الدائم لصد replay */
  readonly minGeneration?: number;
}

/**
 * يتحقق من المظروف كلياً ويعيد محتواه بعد بوابة كل الحالات (أمر §6: التحقق
 * من التوقيع قبل استخدام الحالة في prompts أو أدوات أو تنفيذ).
 * رموز الرفض الموحدة: SNAPSHOT_UNSUPPORTED_VERSION / SNAPSHOT_MALFORMED /
 * SNAPSHOT_UNKNOWN_KEY / SNAPSHOT_BAD_SIGNATURE / SNAPSHOT_EXPIRED /
 * SNAPSHOT_IDENTITY_MISMATCH / SNAPSHOT_RESUMER_NOT_ALLOWED /
 * SNAPSHOT_AUTHORIZATION_STALE / SNAPSHOT_POLICY_UNSUPPORTED / SNAPSHOT_REPLAY.
 */
export function verifySignedSnapshot(
  envelopeJson: string,
  keyRing: SnapshotKeyRing,
  expected: VerifySnapshotExpectations,
): Result<{ readonly facts: SignedSnapshotFacts; readonly payload: SnapshotBodyFields }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelopeJson) as unknown;
  } catch {
    return err(snapshotError("SNAPSHOT_MALFORMED", "snapshot ليس JSON صالحاً"));
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return err(snapshotError("SNAPSHOT_MALFORMED", "snapshot ليس كائناً صالحاً"));
  }
  const record = parsed as Record<string, unknown>;
  if (record["snapshotVersion"] !== SIGNED_SNAPSHOT_VERSION) {
    return err(snapshotError("SNAPSHOT_UNSUPPORTED_VERSION", `إصدار snapshot غير مدعوم: ${String(record["snapshotVersion"])} — المدعوم ${SIGNED_SNAPSHOT_VERSION}`));
  }
  const facts = record["facts"] as SignedSnapshotFacts | undefined;
  const payload = record["payload"] as SnapshotBodyFields | undefined;
  const auth = record["auth"] as SignedSnapshotEnvelope["auth"] | undefined;
  if (facts === undefined || payload === undefined || auth === undefined || auth.alg !== AUTH_ALG || typeof auth.value !== "string") {
    return err(snapshotError("SNAPSHOT_MALFORMED", "توقيع ناقص أو حقول المظروف غير مكتملة"));
  }
  const publicKey = keyRing.get(auth.keyId);
  if (publicKey === undefined) {
    return err(snapshotError("SNAPSHOT_UNKNOWN_KEY", `keyId غير معروف: ${auth.keyId} — لا ثقة بمفتاح خارج حلقة الثقة`));
  }
  const valid = verifySignature(null, signingInput(facts, payload), publicKey, Buffer.from(auth.value, "base64"));
  if (!valid) {
    return err(snapshotError("SNAPSHOT_BAD_SIGNATURE", "توقيع snapshot لا يطابق محتواها — احتمال عبث أو تزوير"));
  }
  const now = expected.now ?? new Date().toISOString();
  if (Date.parse(facts.expiresAt) <= Date.parse(now)) {
    return err(snapshotError("SNAPSHOT_EXPIRED", `snapshot منتهية الصلاحية عند ${facts.expiresAt}`));
  }
  if (expected.minGeneration !== undefined && facts.generation < expected.minGeneration) {
    return err(snapshotError("SNAPSHOT_REPLAY", `generation ${facts.generation} أقدم من المعتمد ${expected.minGeneration} — رفض replay`));
  }
  // مطابقة الهوية إلزامية حين يمرر المستدعي هوية متوقعة (مسار الاستئناف)
  if (expected.runId !== undefined && (facts.runId !== expected.runId || payload.runId !== expected.runId)) {
    return err(snapshotError("SNAPSHOT_IDENTITY_MISMATCH", "runId في snapshot لا يطابق هوية التشغيل الموثوقة — رُفض الاستئناف العابر"));
  }
  if (expected.tenantId !== undefined && (facts.tenantId !== expected.tenantId || payload.tenantId !== expected.tenantId)) {
    return err(snapshotError("SNAPSHOT_IDENTITY_MISMATCH", "tenantId في snapshot لا يطابق هوية المستأجر الموثوقة — رُفض الاستئناف العابر"));
  }
  if (facts.policyVersion !== (expected.policyVersion ?? SNAPSHOT_POLICY_VERSION)) {
    return err(snapshotError("SNAPSHOT_POLICY_UNSUPPORTED", `إصدار سياسة snapshot غير مدعوم: ${facts.policyVersion}`));
  }
  if (facts.resumeBinding.allowedSubjects.length > 0) {
    if (expected.resumerSubject === undefined || !facts.resumeBinding.allowedSubjects.includes(expected.resumerSubject)) {
      return err(snapshotError("SNAPSHOT_RESUMER_NOT_ALLOWED", "المُستأنف ليس ضمن الهويات المخولة في snapshot"));
    }
  }
  if (expected.authorizationVersion !== undefined && expected.authorizationVersion < facts.resumeBinding.minAuthorizationVersion) {
    return err(snapshotError("SNAPSHOT_AUTHORIZATION_STALE", `إصدار التخويل الحالي ${expected.authorizationVersion} أدنى من المعتمد ${facts.resumeBinding.minAuthorizationVersion} — لا استعادة صلاحيات مبطلة`));
  }
  return ok({ facts, payload });
}

/** تصنيف snapshot واردة: موقعة v2 / legacy v1 (بصمة مجردة) / غير معروفة */
export function classifySnapshot(envelopeJson: string): "signed" | "legacy" | "unknown" {
  try {
    const parsed = JSON.parse(envelopeJson) as Record<string, unknown>;
    if (parsed["snapshotVersion"] === SIGNED_SNAPSHOT_VERSION && parsed["auth"] !== undefined) return "signed";
    if (parsed["version"] === 1 && parsed["integrity"] !== undefined) return "legacy";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * هجرة مصرحة لـsnapshot legacy: تتحقق ببصمة SHA-256 القديمة (كشف العبث
 * اللاحق فقط — لا مصادقة) وتتطلب authorizedBy صريحاً، ثم تُعيد التوقيع
 * بعلامة migratedFrom:1 وgeneration جديدة — **لا تمنح الحالة القديمة ثقة
 * أعلى مما كانت**: تظل خاضعة لنفس بوابات الهوية والصلاحية عند الاستئناف،
 * وauthorizedBy يوثق في facts ليصل لسلسلة التدقيق مع الحدث.
 */
export function migrateLegacySnapshot(input: {
  readonly legacyJson: string;
  readonly material: SnapshotSigningMaterial;
  readonly authorizedBy: string;
  readonly generation: number;
  readonly body: SnapshotBodyFields;
  readonly resumeBinding: SnapshotResumeBinding;
  readonly now?: string;
}): Result<string> {
  const classified = classifySnapshot(input.legacyJson);
  if (classified === "signed") {
    return err(snapshotError("SNAPSHOT_LEGACY_MIGRATION_INVALID", "الهجرة للـlegacy حصراً — snapshot موقعة لا تهاجر"));
  }
  if (classified !== "legacy") {
    return err(snapshotError("SNAPSHOT_LEGACY_MIGRATION_INVALID", "snapshot ليست legacy v1 صالحة البنية — رُفضت الهجرة"));
  }
  // بوابة الحقاقة القديمة: أي عبث بعد الحقاقة الأصلية يُكتشف هنا قبل إعادة التوقيع
  const parsed = JSON.parse(input.legacyJson) as Record<string, unknown>;
  const { integrity, ...body } = parsed;
  // حقاقة الإصدار 1 كانت على JSON.stringify المباشر (ترتيب الإدراج) — نطابقها كما كانت
  if (createHash("sha256").update(JSON.stringify(body)).digest("hex") !== integrity) {
    return err(snapshotError("SNAPSHOT_LEGACY_MIGRATION_INVALID", "بصمة legacy لا تطابق محتواها — عبث مكتشف، لا هجرة"));
  }
  const now = input.now ?? new Date().toISOString();
  return ok(
    signSnapshot({
      facts: {
        runId: input.body.runId,
        tenantId: input.body.tenantId,
        createdAt: now,
        generation: input.generation,
        policyVersion: SNAPSHOT_POLICY_VERSION,
        resumeBinding: input.resumeBinding,
        inputDigests: { migratedBy: input.authorizedBy, legacyIntegrity: String(integrity) },
        migratedFrom: 1,
      },
      payload: input.body,
      material: input.material,
      now,
    }),
  );
}

