/**
 * مبدئو دولاب التعلم L4 — دوال نقية فقط (وثيقة memory.md §L4).
 *
 * التحويل بين Lesson النطاقية وصف FlywheelLesson العلائقي.
 * لا منطق شبكي ولا اعتماد على Prisma هنا — محض تحويل.
 */

import type { Lesson } from "@agentbridge/memory";

// صف FlywheelLesson كما في schema.prisma — أسماء snake_case مطابقة للقاعدة
export interface FlywheelLessonRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly spec_pattern: string;
  readonly design_decision: string;
  readonly outcome: string;
  readonly score: number;
  readonly lesson_json: string;
  readonly created_at: Date;
}

// اشتقاق معرف حتمي من حقول الدرس — بلا عشوائية ولا UUID خارجي
function deriveId(lesson: Lesson): string {
  const raw = `${lesson.tenantId}|${lesson.specPattern}|${lesson.designDecision}|${lesson.createdAt}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) hash = Math.imul(31, hash) + raw.charCodeAt(i) | 0;
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `${lesson.tenantId.slice(0, 8)}-${lesson.specPattern.slice(0, 8).replace(/[^a-zA-Z0-9]/gu, "_")}-${hex}-${lesson.createdAt.replace(/[^0-9]/gu, "").slice(0, 8)}`;
}

export function lessonToRow(lesson: Lesson): FlywheelLessonRow {
  const id = lesson.id ?? deriveId(lesson);
  return {
    id,
    tenant_id: lesson.tenantId,
    spec_pattern: lesson.specPattern,
    design_decision: lesson.designDecision,
    outcome: lesson.outcome,
    score: lesson.score,
    lesson_json: JSON.stringify({ ...lesson, id }),
    created_at: new Date(lesson.createdAt),
  };
}

export function lessonFromRow(row: FlywheelLessonRow): Lesson {
  const parsed = JSON.parse(row.lesson_json) as Lesson;
  return {
    id: row.id,
    specPattern: parsed.specPattern,
    designDecision: parsed.designDecision,
    outcome: parsed.outcome,
    score: parsed.score,
    tenantId: parsed.tenantId,
    createdAt: parsed.createdAt,
  };
}
