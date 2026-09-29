/**
 * أنواع التدقيق والإصلاح — عملة التداول بين المدقق والمصلح والمنسق.
 *
 * دورة الحياة (وثيقة 04): فشل التحصين/التقييم يُحوَّل FailureReport
 * ← المدقق يرتّب النتائج ويضيف توصية إصلاح (AuditedFinding)
 * ← المصلح ينتج ترقيعاً موضعياً (RepairPatch) بلا إعادة توليد كاملة.
 *
 * كل ما يعبر حدود العملية أو يخرج من نموذج يمر بمخطط Zod صارم (القاعدة 16).
 */

import { z } from "zod";
import { StageId, StageIds } from "./pipeline.js";

/**
 * مراحل التدقيق الخاصة بدورة حياة المستأجر.
 * منفصلة عن مراحل الخط الثماني كي لا يتسخ عقد الأنبوب؛ سلسلة الهاش
 * تحسب على النص كما هو فإضافة قيم لا يكسر التحقق التاريخي.
 */
export const LifecycleAuditStages = [
  "tenant_onboarding",
  "tenant_deletion",
  "credential_rotation",
  "retention_sweep",
] as const;

export type LifecycleAuditStage = (typeof LifecycleAuditStages)[number];

/** اتحاد مراحل التدقيق: مراحل الأنبوب + مراحل دورة الحياة */
export const AuditStageIds = [...StageIds, ...LifecycleAuditStages] as const;
export type AuditStage = StageId | LifecycleAuditStage;

/** نتيجة أمنية أثريها المدقق بتوصية إصلاح عربية محددة */
export interface AuditedFinding {
  /** معرف النتيجة الأصلية من تقرير التحصين — لا يخترع المدقق معرفات */
  readonly id: string;
  readonly severity: "critical" | "high" | "medium" | "info";
  readonly title: string;
  /** موضع الإخفاق كما ورد في التقرير */
  readonly location?: string;
  /** توصية الإصلاح — عربية محددة قابلة للتنفيذ، لا عموميات */
  readonly recommendedFix: string;
}

/** تقرير فشل مرحلة — المدخل الرسمي لوكيل الإصلاح والمدقق معاً */
export interface FailureReport {
  /** المرحلة التي فشلت */
  readonly stage: StageId;
  /** ملخص عربي لطبيعة الفشل */
  readonly summary: string;
  /** النتائج المرتبطة بالفشل (فارغة للفشل البنيوي الصرف) */
  readonly findings: readonly AuditedFinding[];
  /** عدد دورات الإصلاح المستهلكة قبل هذا التقرير */
  readonly attempt: number;
}

/** ترقيع ملف واحد داخل artifact — استبدال كامل لمحتواه المحدد */
export interface FilePatch {
  /** مسار نسبي يجب أن يطابق ملفاً موجوداً — المصلح لا يضيف ملفات جديدة */
  readonly path: string;
  readonly contents: string;
}

/** خرج وكيل الإصلاح: تعديلات موضعية على ملفات قائمة + تبرير موثق */
export interface RepairPatch {
  readonly files: readonly FilePatch[];
  /** شرح عربي لكل تعديل ولماذا يعالج النتيجة المستهدفة */
  readonly rationale: readonly string[];
}

/* مخططات Zod — بوابة قبول مخارج الوكلاء قبل دخولها النظام */

export const AuditedFindingSchema = z
  .object({
    id: z.string().min(1),
    severity: z.enum(["critical", "high", "medium", "info"]),
    title: z.string().min(1),
    location: z.string().optional(),
    recommendedFix: z.string().min(5),
  })
  .strict();

export const FilePatchSchema = z
  .object({
    path: z.string().min(1),
    contents: z.string(),
  })
  .strict();

export const RepairPatchSchema = z
  .object({
    files: z.array(FilePatchSchema).min(1).max(20),
    rationale: z.array(z.string().min(3)).min(1),
  })
  .strict();

/* ---------- سجل التدقيق append-only بسلسلة hash (وثيقة security.md §7) ---------- */

/** صف واحد في سجل التدقيق — السلسلة: hash_n = sha256(hash_{n-1} + canonical(الحقول)) */
export interface AuditTrailEntry {
  /** الرقم التسلسلي داخل نطاق المستأجر الواحد — يبدأ من 1 */
  readonly seq: number;
  readonly tenantId: string;
  readonly runId: string;
  /** المرحلة التي وقع عندها الحدث — أنبوب أو دورة حياة مستأجر */
  readonly stage: AuditStage;
  /** القرار: حالة المرحلة الجديدة أو "event" للأحداث غير الحالة */
  readonly decision: string;
  /** ملخص مجرد بلا PII وبلا أسرار — ما يُدقق عليه لاحقاً فقط */
  readonly abstractedPayload: string;
  readonly at: string;
  /** هاش الصف السابق في سلسلة المستأجر، أو GENESIS لأول صف */
  readonly prevHash: string;
  readonly hash: string;
}

/** بذرة السلسلة لأول صف لكل مستأجر */
export const AUDIT_GENESIS_HASH = "0".repeat(64);

export const AuditTrailEntrySchema = z
  .object({
    seq: z.number().int().positive(),
    tenantId: z.string().min(1),
    runId: z.string().min(1),
    stage: z.enum(AuditStageIds),
    decision: z.string().min(1).max(50),
    abstractedPayload: z.string().max(1000),
    at: z.string(),
    prevHash: z.string().length(64),
    hash: z.string().length(64),
  })
  .strict();
