/**
 * سياسة الاحتفاظ (fail-closed) — النوع والمخطط والافتراضي التطويري.
 *
 * كل صنف بيانات له قيمة صريحة مستقلة — لا تُربط البيانات كلها بمدة واحدة.
 * المدد التجارية/القانونية قرار إداري؛ ما هنا الإطار التقني الذي يرفض
 * إقلاع الإنتاج بلا سياسة معلنة ويرفض القيم غير المنطقية.
 *
 * أوضاع الإنفاذ الموثقة بصدق في نتيجة المسح:
 * - ttl-at-write: يُنفذ عند الكتابة (L1 أحداث، snapshots).
 * - swept: ممسوح دورياً عبر retention-sweeper (حزم، جلسات، معاملات دخول).
 * - declared: معلن يطبقه تشغيل النشر (سجلات تشغيلية، نسخ احتياطية) —
 *   لا ادعاء حذف داخل قاعدة بيانات لبيانات خارجها.
 * - tenant-lifetime: يموت بموت المستأجر عبر سير الحذف (نواة L2).
 * - ephemeral: يموت بانتهاء العملية (L0) — لا شيء يُعلن زائفاً.
 * - permanent: دائم بقرار نزاعة (تدقيق، إبطالات) أو بقرار سياسة.
 */

import { z } from "zod";

/** قيمة احتفاظ لأصناف قابلة للتقادم: أيام أو "permanent" */
const DaysOrPermanent = z.union([z.number().int().min(1).max(36500), z.literal("permanent")]);

export interface RetentionPolicy {
  /** L1 أحداث (Redis) — أيام، TTL عند الكتابة */
  readonly episodicEventsDays: number;
  /** snapshots الموقعة — أيام، TTL عند الكتابة */
  readonly signedSnapshotsDays: number;
  /** أرشيف run_state_archives */
  readonly runArchives: number | "permanent";
  /** سجلات الشهادات (صفوف القرار) */
  readonly certificates: number | "permanent";
  /** حزم الخوادم المولدة */
  readonly artifacts: number | "permanent";
  /** سجل التدقيق — دائم حصراً (نزاعة السلسلة) */
  readonly auditLog: "permanent";
  /** إبطالات الشهادات — دائمة حصراً؛ /verify العام يرفض بها */
  readonly revocations: "permanent";
  /** نواة L2 الدلالية (مشاريع/مواصفات/تشغيلات) — تموت بسير حذف المستأجر */
  readonly semanticCore: "tenant-lifetime";
  /** جلسات المتصفح — سقف أيام لمسح الصفوف المنتهية */
  readonly sessions: number | "permanent";
  /** معاملات دخول OIDC — سقف أيام لمسح المنتهي والمستهلك */
  readonly loginTransactions: number | "permanent";
  /** السجلات التشغيلية خارج القاعدة — معلن، يطبقه تشغيل النشر */
  readonly operationalLogs: number | "permanent";
  /** النسخ الاحتياطية — معلن، يطبقه مدير النسخ؛ لا حذف داخلها يُدعى */
  readonly backups: number | "permanent";
  /** L0 ذاكرة العمل — عابرة بعملية التشغيل حصراً */
  readonly memoryWorking: "ephemeral";
  /** L3 المتجهية (memory_embeddings) — أيام أو دائم */
  readonly memoryVector: number | "permanent";
  /** L4 دولاب التعلم (flywheel_lessons) — أيام أو دائم */
  readonly flywheelLessons: number | "permanent";
  /** إعداد SSO للمستأجر — يبقى حياً مع المستأجر ويُمسح بسير الحذف */
  readonly ssoConfig: "tenant-lifetime";
}

/** مخطط سياسة الاحتفاظ — صارم: حقل زائد أو ناقص يرفض */
export const RetentionPolicySchema = z.object({
  episodicEventsDays: z.number().int().min(1).max(3650),
  signedSnapshotsDays: z.number().int().min(1).max(3650),
  runArchives: DaysOrPermanent,
  certificates: DaysOrPermanent,
  artifacts: DaysOrPermanent,
  auditLog: z.literal("permanent"),
  revocations: z.literal("permanent"),
  semanticCore: z.literal("tenant-lifetime"),
  sessions: DaysOrPermanent,
  loginTransactions: DaysOrPermanent,
  operationalLogs: DaysOrPermanent,
  backups: DaysOrPermanent,
  memoryWorking: z.literal("ephemeral"),
  memoryVector: DaysOrPermanent,
  flywheelLessons: DaysOrPermanent,
  ssoConfig: z.literal("tenant-lifetime"),
}).strict();

/**
 * سياسة التطوير/الاختبار — قيم قصيرة اصطناعية للحقن في الاختبارات فقط؛
 * الإنتاج يلزم بسياسة معلنة من إعداد النشر ولا يرث هذه القيم إطلاقاً
 * (RETENTION_DURATIONS = BLOCKED_OWNER_INPUT).
 */
export const DEV_RETENTION_POLICY: RetentionPolicy = {
  episodicEventsDays: 7,
  signedSnapshotsDays: 7,
  runArchives: "permanent",
  certificates: "permanent",
  artifacts: "permanent",
  auditLog: "permanent",
  revocations: "permanent",
  semanticCore: "tenant-lifetime",
  sessions: "permanent",
  loginTransactions: "permanent",
  operationalLogs: "permanent",
  backups: "permanent",
  memoryWorking: "ephemeral",
  memoryVector: "permanent",
  flywheelLessons: "permanent",
  ssoConfig: "tenant-lifetime",
};
