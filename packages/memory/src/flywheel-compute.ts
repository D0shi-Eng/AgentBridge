/**
 * حساب تحليلات Flywheel — حتمي صرف بلا شبكة ولا نموذج.
 * مستخلص من flywheel.ts للحفاظ على حدود الملفات؛ كل المدخلات
 * دروس مفلترة مسبقاً بمستأجر السياق فلا تسرّب بين المستأجرين.
 */
import type { FlywheelAnalytics, FlywheelRange, Lesson } from "./flywheel.js";

// تحويل النطاق إلى أيام — حتمي بلا شبكة
function rangeToDays(range: FlywheelRange): number {
  if (range === "7d") return 7;
  if (range === "30d") return 30;
  return 90;
}

// مفتاح يوم UTC بصيغة YYYY-MM-DD
function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// حساب التحليلات حتمياً من قائمة دروس مفلترة — لا منطق شبكي
export function computeAnalytics(filtered: readonly Lesson[], range: FlywheelRange, now: Date): FlywheelAnalytics {
  const total = filtered.length;
  const sum = filtered.reduce((acc, cur) => acc + cur.score, 0);
  const avgScore = total === 0 ? 0 : Math.round((sum / total) * 100) / 100;
  const successCount = filtered.filter((lesson) => lesson.outcome === "success").length;
  const successRate = total === 0 ? 0 : Math.round((successCount / total) * 10000) / 10000;
  // histogram 5 فئات 0-20..81-100
  const histogram = [0, 0, 0, 0, 0];
  for (const lesson of filtered) {
    const score = lesson.score;
    const idx = score <= 20 ? 0 : score <= 40 ? 1 : score <= 60 ? 2 : score <= 80 ? 3 : 4;
    const current = histogram[idx] ?? 0;
    histogram[idx] = current + 1;
  }
  // topPatterns أعلى 5 تكراراً مرتبة count ثم avgScore
  const byPattern = new Map<string, { count: number; total: number }>();
  for (const lesson of filtered) {
    const entry = byPattern.get(lesson.specPattern) ?? { count: 0, total: 0 };
    entry.count += 1;
    entry.total += lesson.score;
    byPattern.set(lesson.specPattern, entry);
  }
  const topPatterns = [...byPattern.entries()]
    .map(([pattern, value]) => ({ pattern, count: value.count, avgScore: Math.round((value.total / value.count) * 100) / 100 }))
    .sort((a, b) => b.count - a.count || b.avgScore - a.avgScore)
    .slice(0, 5);
  // trend: عدد لكل يوم ضمن النطاق
  const days = rangeToDays(range);
  const trendMap = new Map<string, number>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(now.getTime() - offset * 86400000);
    trendMap.set(dateKey(day), 0);
  }
  for (const lesson of filtered) {
    const key = dateKey(new Date(lesson.createdAt));
    if (trendMap.has(key)) trendMap.set(key, (trendMap.get(key) ?? 0) + 1);
  }
  const trend = [...trendMap.entries()].map(([date, count]) => ({ date, count }));
  return { totalLessons: total, avgScore, successRate, successCount, histogram, topPatterns, trend };
}
