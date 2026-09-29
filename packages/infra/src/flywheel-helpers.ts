/** مبدئات حتمية لتحليلات حلقة التعلّم والتضمين المحلي. */
import type { FlywheelAnalytics, FlywheelRange, Lesson } from "@agentbridge/memory";

export function rangeToDays(range: FlywheelRange): number {
  if (range === "7d") return 7;
  if (range === "30d") return 30;
  return 90;
}

function dateKey(date: Date): string { return date.toISOString().slice(0, 10); }

export function computeFlywheelAnalytics(filtered: Lesson[], range: FlywheelRange, now: Date): FlywheelAnalytics {
  const total = filtered.length;
  const sum = filtered.reduce((acc, cur) => acc + cur.score, 0);
  const avgScore = total === 0 ? 0 : Math.round((sum / total) * 100) / 100;
  const successCount = filtered.filter((lesson) => lesson.outcome === "success").length;
  const successRate = total === 0 ? 0 : Math.round((successCount / total) * 10000) / 10000;
  const histogram = [0, 0, 0, 0, 0];
  for (const lesson of filtered) {
    const index = lesson.score <= 20 ? 0 : lesson.score <= 40 ? 1 : lesson.score <= 60 ? 2 : lesson.score <= 80 ? 3 : 4;
    histogram[index] = (histogram[index] ?? 0) + 1;
  }
  const byPattern = new Map<string, { count: number; total: number }>();
  for (const lesson of filtered) {
    const entry = byPattern.get(lesson.specPattern) ?? { count: 0, total: 0 };
    entry.count += 1;
    entry.total += lesson.score;
    byPattern.set(lesson.specPattern, entry);
  }
  const topPatterns = [...byPattern.entries()]
    .map(([pattern, value]) => ({ pattern, count: value.count, avgScore: Math.round((value.total / value.count) * 100) / 100 }))
    .sort((a, b) => b.count - a.count || b.avgScore - a.avgScore).slice(0, 5);
  const days = rangeToDays(range);
  const trendMap = new Map<string, number>();
  for (let offset = days - 1; offset >= 0; offset -= 1) trendMap.set(dateKey(new Date(now.getTime() - offset * 86400000)), 0);
  for (const lesson of filtered) {
    const key = dateKey(new Date(lesson.createdAt));
    if (trendMap.has(key)) trendMap.set(key, (trendMap.get(key) ?? 0) + 1);
  }
  return { totalLessons: total, avgScore, successRate, successCount, histogram, topPatterns,
    trend: [...trendMap.entries()].map(([date, count]) => ({ date, count })) };
}

export function embedLessonDeterministic(text: string): number[] {
  const counts = new Array<number>(1536).fill(0);
  for (const token of text.toLowerCase().split(/[^a-z0-9\u0600-\u06ff]+/u)) {
    if (token.length === 0) continue;
    let hash = 0x811c9dc5;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    const bucket = (hash >>> 0) % counts.length;
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  const norm = Math.sqrt(counts.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? counts : counts.map((value) => value / norm);
}
