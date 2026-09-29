/**
 * سجل المقاييس الحتمي — عدّادات وهيستوغرام بلا تبعيات خارجية.
 *
 * ماهيته: يخزن inc(name,labels) و histogram(name,value) في خرائط نقية ثم يعيد لقطة.
 * وظيفته: تغذية GET /metrics بنص prometheus بسيط واختبارات دقيقة لحساب الطلبات.
 * كيف: Map<string,number> فقط — المفتاح المركب name{label="value"} حتمي ومرتب.
 */

// لقطة المقاييس — عدّادات وهيستوغرام مجمعة
export interface MetricsSnapshot {
  readonly counters: Readonly<Record<string, number>>;
  readonly histograms: Readonly<Record<string, { readonly sum: number; readonly count: number; readonly avg: number }>>;
}

// مسجل حتمي بلا تبعيات — دوال نقية على Map فقط
export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, { sum: number; count: number }>();

  /** يزيد عدّاداً بمفتاح مركب من الاسم والوسوم */
  inc(name: string, labels: Readonly<Record<string, string>> = {}): void {
    const key = buildKey(name, labels);
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + 1);
  }

  /** يسجل قيمة في هيستوغرام بالاسم */
  histogramObserve(name: string, value: number): void {
    const entry = this.histograms.get(name) ?? { sum: 0, count: 0 };
    entry.sum += value;
    entry.count += 1;
    this.histograms.set(name, entry);
  }

  /** لقطة حالية — نسخ حتمية مرتبة */
  snapshot(): MetricsSnapshot {
    const counters: Record<string, number> = {};
    for (const [key, value] of [...this.counters.entries()].sort()) counters[key] = value;
    const histograms: Record<string, { sum: number; count: number; avg: number }> = {};
    for (const [key, value] of [...this.histograms.entries()].sort()) {
      histograms[key] = { sum: value.sum, count: value.count, avg: value.count === 0 ? 0 : value.sum / value.count };
    }
    return { counters, histograms };
  }

  /** نص prometheus بسيط للقراءة العامة — كل عدّاد سطر واحد */
  toPrometheus(): string {
    const lines: string[] = [];
    for (const [key, value] of [...this.counters.entries()].sort()) lines.push(`${key} ${String(value)}`);
    for (const [key, value] of [...this.histograms.entries()].sort()) {
      lines.push(`${key}_sum ${String(value.sum)}`);
      lines.push(`${key}_count ${String(value.count)}`);
    }
    return lines.join("\n") + (lines.length > 0 ? "\n" : "");
  }
}

function buildKey(name: string, labels: Readonly<Record<string, string>>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return name;
  const labelStr = entries.map(([k, v]) => `${k}="${v}"`).join(",");
  return `${name}{${labelStr}}`;
}
