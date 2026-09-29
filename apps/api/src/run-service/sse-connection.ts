/**
 * اتصال SSE منظم — موثوقية بث الأحداث.
 *
 * ماهيته: وحدة تدير اتصال SSE واحداً فوق مصير خام قابل للحقن —
 * heartbeat دوري، سطر id لكل حدث (cursor = at ISO تصاعدي لكل تشغيل)،
 * استئناف من Last-Event-ID، ضغط ارتدادي مغلق (عميل بطيء يُفصل بعد
 * امتلاء مخزن متكرر فيستأنف من حيث توقف بلا فقد)، وحصة اتصالات
 * لكل مستأجر.
 * كيف: لا منطق HTTP هنا — المصير يوفر write()/end() والساعة قابلة
 * للحقن فالاختبارات حتمية بلا انتظار حقيقي ولا حمل شبكة.
 */

/** أصغر سطح مصير خام — reply.raw فعلياً أو مزدوج اختباري */
export interface RawSinkLike {
  write(chunk: string): boolean;
  end(): void;
  destroyed?: boolean;
}

/** خيارات الاتصال — الافتراضيات موثقة في وثيقة 08 */
export interface SseConnectionOptions {
  /** فاصل heartbeat بالمللي (تعليق ": ping" يمنع قطع البروكسيات الخاملة) */
  readonly heartbeatMs?: number;
  /** عدد الكتابات المتتالية على مخزن ممتلئ قبل فصل العميل البطيء */
  readonly maxFullBufferWrites?: number;
  /** حقن المؤقتات لاختبار حتمي — الافتراضي مؤقتات العملية */
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
  readonly now?: () => number;
  /**
   * نداء دوري مع كل heartbeat — تستخدمه الحصة الموزعة
   * لتجديد TTL مفتاح المستأجر (شبكة أمان الانهيار). فشلها لا يسقط
   * الاتصال الحي — الموثق في sse-quota-redis.ts.
   */
  readonly onHeartbeat?: () => void;
}

/** حصة اتصالات SSE لكل مستأجر — بلا نمو غير محدود في الجداول */
export const SSE_MAX_CONNECTIONS_PER_TENANT = 32;

export class SseTenantConnectionQuota {
  private readonly counts = new Map<string, number>();
  /** يحجز مقعداً — false عند بلوغ الحصة (يُرفض الاتصال قبل أي كتابة) */
  acquire(tenantId: string): boolean {
    const current = this.counts.get(tenantId) ?? 0;
    if (current >= SSE_MAX_CONNECTIONS_PER_TENANT) return false;
    this.counts.set(tenantId, current + 1);
    return true;
  }
  release(tenantId: string): void {
    const current = this.counts.get(tenantId) ?? 0;
    if (current <= 1) this.counts.delete(tenantId);
    else this.counts.set(tenantId, current - 1);
  }
  /** للمراقبة والاختبار — عدد اتصالات مستأجر الآن */
  countOf(tenantId: string): number {
    return this.counts.get(tenantId) ?? 0;
  }
}

/** سجل حصص مشترك بمستوى العملية — بديل بسيط عن جدول عالمي */
export const sseQuota = new SseTenantConnectionQuota();


export class SseConnection {
  private fullBufferStreak = 0;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(
    private readonly sink: RawSinkLike,
    private readonly options: SseConnectionOptions = {},
  ) {
    const heartbeatMs = options.heartbeatMs ?? 15_000;
    const setIntervalFn = options.setIntervalFn ?? setInterval;
    this.heartbeatTimer = setIntervalFn(() => {
      if (this.closed || this.sink.destroyed === true) return;
      // تجديد حصة المستأجر الموزعة مع نبض الاتصال —
      // قبل الكتابة حتى يعيش المفتاح ما دام الاتصال حياً
      if (options.onHeartbeat !== undefined) options.onHeartbeat();
      // تعليق heartbeat لا يحمل حدثاً — لا تعويض زور لما فُقد
      const ok = this.sink.write(": ping\n\n");
      if (!ok) this.noteBackpressure();
    }, heartbeatMs);
  }

  /** يكتب حدثاً كسطرَي id+data — false تعني مخزناً ممتلئاً (ضغط ارتدادي) */
  sendEvent<T extends { readonly at: string }>(event: T): boolean {
    if (this.closed || this.sink.destroyed === true) return false;
    // id = at ISO (تصاعدي لكل تشغيل) — العميل يعيده Last-Event-ID عند العودة
    const ok = this.sink.write(`id: ${event.at}\ndata: ${JSON.stringify(event)}\n\n`);
    if (!ok) this.noteBackpressure();
    else this.fullBufferStreak = 0;
    return ok;
  }

  /** إعادة الأحداث السابقة بعد تصفية المؤشر — يظهر سطر retry للعميل */
  replay<T extends { readonly at: string }>(replayed: readonly T[], lastEventId?: string): void {
    const cursor = lastEventId !== undefined && lastEventId.length > 0 ? lastEventId : null;
    for (const event of replayed) {
      // الأحداث الأقدم من المؤشر لا تُعاد — لا ازدواج عند العميل العائد
      if (cursor !== null && event.at <= cursor) continue;
      this.sendEvent(event);
    }
  }

  private noteBackpressure(): void {
    this.fullBufferStreak += 1;
    if (this.fullBufferStreak >= (this.options.maxFullBufferWrites ?? 4)) {
      // فصل العميل البطيء مقصود وموثق: المخزن لن ينمو بلا حد، والعميل
      // يستأنف من آخر id استلمه — فقد صفر أحداث بلا تجميع غير محدود
      this.close();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const clearIntervalFn = this.options.clearIntervalFn ?? clearInterval;
    if (this.heartbeatTimer !== undefined) clearIntervalFn(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    try {
      this.sink.end();
    } catch {
      // مصير مغلق أصلاً — الإغلاق مرة واحدة كافٍ
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
