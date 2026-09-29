/**
 * بث أحداث التشغيل NDJSON — Readable يجمع الإعادة التاريخية والبث الحي.
 *
 * عند الاتصال أثناء تشغيل جارٍ: تعاد الأحداث المخزنة في L1 بترتيبها
 * ثم يبث كل حدث جديد لحظة وقوعه حتى الحالة النهائية فيُغلق الدفق.
 * عند الاتصال بعد الانتهاء: إعادة تاريخية كاملة ثم إغلاق فوري.
 * كل سطر = كائن PipelineEvent JSON واحد.
 */

import { Readable } from "node:stream";
import type { PipelineEvent } from "@agentbridge/shared";

export interface EventStreamSource {
  /** الأحداث المخزنة حتى لحظة الفتح */
  readonly replayed: readonly PipelineEvent[];
  /** يسجل مستمعاً للأحداث اللاحقة ويعيد إلغاء الاشتراك */
  subscribe(handlers: { onEvent: (event: PipelineEvent) => void; onDone: () => void }): () => void;
}

function toLine(event: PipelineEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export class LiveNdjsonStream extends Readable {
  constructor(source: EventStreamSource) {
    super({ encoding: "utf8" });
    for (const event of source.replayed) this.push(toLine(event));
    // إن كان التشغيل منتهياً يستدعي المصدر onDone فوراً داخل الاشتراك
    // فيصل push(null) بعد صفوف الإعادة فيُغلق الدفق بترتيب صحيح.
    this.unsubscribe = source.subscribe({
      onEvent: (event) => this.push(toLine(event)),
      onDone: () => this.push(null),
    });
  }

  private readonly unsubscribe: () => void;

  override _read(): void {
    // الضخ يتم دفعياً من المصدر؛ القراءة تسحب من المخزن الداخلي تلقائياً
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.unsubscribe();
    callback(error);
  }
}
