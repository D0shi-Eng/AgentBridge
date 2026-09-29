/**
 * محدد الطلبات المحلي — نافذة منزلقة حتمية في ذاكرة العملية.
 *
 * ماهيته: نافذة منزلقة حتمية في ذاكرة العملية تحصي محاولات كل مفتاح
 * (IP قبل المصادقة، tenantId بعدها) وترفض فوق السقف.
 *
 * **حد معلن لا يُخفى**: هذا محدد محلي العملية — ليس موزعاً. عداداته
 * لا تُشارك بين نسخ متعددة ولا تنجو إعادة التشغيل، والحصة لكل عملية
 * على حدة. الحد الموزع (Redis) يبقى للمرحلة 4 وفق مصفوفة القبول.
 * الرفض يُطبق مع معامل Retry-After حتى لا يعيد العميل فوراً.
 */

/** سقوف القواعد الافتراضية — قرارات مثبتة قابلة للاختبار (طلبات/نافذة) */
export const RATE_LIMIT_RULES = {
  /** نقاط الدخول قبل المصادقة — أوسع لتحمل عناوين NAT مشتركة */
  preAuthPerMinute: 30,
  /** القراءات بعد المصادقة لكل مستأجر */
  tenantReadPerMinute: 600,
  /** التشغيلات المكلفة (pipelines) لكل مستأجر */
  tenantRunPerMinute: 10,
} as const;

/** طول النافذة بالميلي ثانية — دقيقة واحدة لكل القواعد الحالية */
export const RATE_WINDOW_MS = 60_000;

/** حالة قرار واحدة: مسموح أو مرفوض مع بقاء النافذة */
export interface RateDecision {
  readonly allowed: boolean;
  /** ثوانٍ حتى إعادة المحاولة — تُرسل في Retry-After عند الرفض */
  readonly retryAfterSeconds: number;
  /** العد الحالي داخل النافذة — للتشخيص والمقاييس */
  readonly count: number;
}

/** محدد مستقل بمصدر زمن قابل للحقن — الاختبار حتمي بلا انتظار حقيقي */
export class RateLimiter {
  private readonly buckets = new Map<string, readonly number[]>();

  constructor(
    private readonly limit: number,
    private readonly nowMs: () => number = () => Date.now(),
    /** سقف مفاتيح نشطة — صد استنزاف ذاكرة بمفاتيح مزيفة لا نهائية */
    private readonly maxBuckets: number = 50_000,
  ) {}

  /** يستهلك محاولة واحدة للمفتاح ويعيد القرار — يُسقط المفاتيح الميتة دورياً */
  consume(key: string): RateDecision {
    const now = this.nowMs();
    // تقليم دوري خفيف: عند تجاوز السقف تُحذف النوافذ المنتهية قبل الرفض الظالم
    if (this.buckets.size >= this.maxBuckets) this.evictExpired(now);
    const windowStart = now - RATE_WINDOW_MS;
    const previous = (this.buckets.get(key) ?? []).filter((stamp) => stamp > windowStart);
    if (previous.length >= this.limit) {
      const oldest = previous[0] ?? now;
      this.buckets.set(key, previous);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000)),
        count: previous.length,
      };
    }
    const updated = [...previous, now];
    this.buckets.set(key, updated);
    return { allowed: true, retryAfterSeconds: 0, count: updated.length };
  }

  /** عدد المفاتيح النشطة — لمقاييس التشغيل والاختبار */
  get activeKeys(): number {
    return this.buckets.size;
  }

  private evictExpired(now: number): void {
    const windowStart = now - RATE_WINDOW_MS;
    for (const [key, stamps] of this.buckets) {
      const alive = stamps.filter((stamp) => stamp > windowStart);
      if (alive.length === 0) this.buckets.delete(key);
      else this.buckets.set(key, alive);
    }
  }
}
