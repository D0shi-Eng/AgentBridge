/**
 * دولاب التعلم L4 — منفذ FlywheelStore ونوع الدرس (وثيقة memory.md §L4).
 *
 * الدرس: نمط مواصفة → قرار تصميم → نتيجة (نجاح/فشل) مع درجة.
 * التخزين بنطاق مستأجر مفروض — كل lesson تحمل tenantId.
 * التحقق عبر Zod قبل الحفظ؛ topK يبحث بالتشابه الحتمي داخل المستأجر.
 * S13: أضيف listRecent + deleteLesson مع عزل مستأجر بنيوي وحذف فهرس L3.
 */

import { z } from "zod";
import type { VectorStore } from "./vector-store.js";
import { requireTenantContext, type TenantContext } from "@agentbridge/shared";
import { computeAnalytics } from "./flywheel-compute.js";

// مخطط الدرس الصارم — كل حقل يُتحقق قبل الدخول للنظام
// source: provenance المنشأ — يمر مع الدرس عند الاسترجاع ولا يضيع
export const LessonSchema = z
  .object({
    id: z.string().min(1).optional(),
    specPattern: z.string().min(1).max(500),
    designDecision: z.string().min(1).max(1000),
    outcome: z.enum(["success", "failure"]),
    score: z.number().int().min(0).max(100),
    tenantId: z.string().min(1),
    createdAt: z.string().min(1),
    source: z.enum(["pipeline", "manual"]).optional(),
  })
  .strict();

export type Lesson = z.infer<typeof LessonSchema>;

// أنواع التحليلات المتقدمة L4 — حتمية بلا تبعيات
export type FlywheelRange = "7d" | "30d" | "90d";
export interface FlywheelAnalytics {
  readonly totalLessons: number;
  readonly avgScore: number;
  readonly successRate: number;
  /** عدد الدروس الناجحة ضمن العينة — يعرض بجانب النسبة كي لا توحي نسبة صغيرة بنتيجة واسعة */
  readonly successCount: number;
  readonly histogram: readonly number[]; // 5 فئات 0-20..81-100
  readonly topPatterns: readonly { readonly pattern: string; readonly count: number; readonly avgScore: number }[];
  readonly trend: readonly { readonly date: string; readonly count: number }[];
}

// منفذ دولاب التعلم — saveLesson يتحقق ثم يحفظ، topK يعيد الأعلى تطابقاً
export interface FlywheelStore {
  saveLesson(context: TenantContext, lesson: Lesson): Promise<void>;
  topK(context: TenantContext, query: string, k: number): Promise<Lesson[]>;
  listRecent(context: TenantContext, limit: number): Promise<Lesson[]>;
  deleteLesson(context: TenantContext, id: string): Promise<void>;
  analytics(context: TenantContext, range: FlywheelRange): Promise<FlywheelAnalytics>;
}

// اشتقاق معرف حتمي — مطابق لمبدئ infra/flywheel-mappers
function deriveId(lesson: Lesson): string {
  const raw = `${lesson.tenantId}|${lesson.specPattern}|${lesson.designDecision}|${lesson.createdAt}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) hash = Math.imul(31, hash) + raw.charCodeAt(i) | 0;
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `${lesson.tenantId.slice(0, 8)}-${lesson.specPattern.slice(0, 8).replace(/[^a-zA-Z0-9]/gu, "_")}-${hex}-${lesson.createdAt.replace(/[^0-9]/gu, "").slice(0, 8)}`;
}

// محول داخل الذاكرة — كامل الوظائف للاختبارات والتطوير بلا بنية
export function createInMemoryFlywheelStore(vectorStore?: VectorStore): FlywheelStore {
  // نخزن مع id حتمي لتسهيل الحذف والاسترجاع
  const lessons: Lesson[] = [];

  return {
    async saveLesson(context: TenantContext, lesson: Lesson): Promise<void> {
      const trusted = requireTenantContext(context);
      const parsed = LessonSchema.safeParse(lesson);
      if (!parsed.success) throw new Error(`درس غير صالح: ${parsed.error.message}`);
      if (parsed.data.tenantId !== trusted.tenantId) throw new Error("مستأجر الدرس لا يطابق السياق الموثوق");
      const id = parsed.data.id ?? deriveId(parsed.data);
      const stored: Lesson = { ...parsed.data, id };
      lessons.push(stored);
      // لا فهرسة شبكية هنا — الحتمية فقط
    },

    async topK(context: TenantContext, query: string, k: number): Promise<Lesson[]> {
      const trusted = requireTenantContext(context);
      if (k <= 0 || query.length === 0) return [];
      const scoped = lessons.filter((lesson) => lesson.tenantId === trusted.tenantId);
      const exact = scoped.filter((lesson) => lesson.specPattern === query);
      const pool = exact.length > 0 ? exact : scoped.filter((lesson) => lesson.specPattern.includes(query) || query.includes(lesson.specPattern));
      const fallback = pool.length > 0 ? pool : scoped;
      const sorted = [...fallback].sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt));
      return sorted.slice(0, Math.floor(k));
    },

    async listRecent(context: TenantContext, limit: number): Promise<Lesson[]> {
      const trusted = requireTenantContext(context);
      if (limit <= 0) return [];
      const scoped = lessons.filter((lesson) => lesson.tenantId === trusted.tenantId);
      const sorted = [...scoped].sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
      return sorted.slice(0, Math.floor(limit));
    },

    async deleteLesson(context: TenantContext, id: string): Promise<void> {
      const trusted = requireTenantContext(context);
      if (id.length === 0) return;
      const index = lessons.findIndex((lesson) => lesson.id === id && lesson.tenantId === trusted.tenantId);
      if (index === -1) return;
      lessons.splice(index, 1);
      // حذف الفهرس في L3 إن وجد — فشل الحذف لا يفشل العملية
      if (vectorStore !== undefined) {
        await vectorStore.remove(trusted, "tool", id);
      }
    },

    async analytics(context: TenantContext, range: FlywheelRange): Promise<FlywheelAnalytics> {
      const trusted = requireTenantContext(context);
      if (range !== "7d" && range !== "30d" && range !== "90d") throw new Error("range غير صالح");
      const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
      const now = new Date();
      const cutoff = new Date(now.getTime() - days * 86400000);
      const filtered = lessons.filter((lesson) => lesson.tenantId === trusted.tenantId && new Date(lesson.createdAt) >= cutoff);
      return computeAnalytics(filtered, range, now);
    },
  };
}
