/**
 * وحدة الاتصال بـRedis — غلاف الاتصال المؤجل مرة واحدة (ADR-13).
 *
 * ماهيتها: لفّ عميل node-redis الرسمي بطبقة تنتظر connect() مرة واحدة ثم
 * تكشف أصغر سطح أوامر يطلبه المحول فقط — فلا يلمس المحول منطق اتصال البتة.
 * وظيفتها: بناء الحاوية يبقى متزامناً (كما في وضع memory) بينما أول أمر
 * فعلي ينتظر الاتصال الصامت؛ والاغلاق ينتظر ثم ينهي بهدوء.
 * كيف: دالة connectOnDemand تغلف createRedisClient وتستخرج commands فضلاً عن
 * disconnect — منطق نقي منعزل لضمان بقاء container.ts ≤200 سطر.
 */

import { createClient as createRedisClient } from "redis";
import type { RedisCommandsLike } from "@agentbridge/infra";
import { adaptRedisV6ForBudget, adaptRedisV6ForLock } from "@agentbridge/infra";

/** أصغر سطح SETNX لمخزن استهلاك HITL — يمرر للعقد عبر البنية كنوع مستقل */
export interface RedisSetNxView {
  set(key: string, value: string, options: { NX?: boolean; PX?: number }): Promise<string | null>;
}

/**
 * يلف عميل Redis باتصال مؤجل — يكشف commands (الشكل العرضي) ويضيف:
 * lockCommands وbudgetCommands (نفس العميل بتواقيع المحولات الحية) وsetNx
 * لمخزن استهلاك HITL — الثلاثة فوق اتصال واحد لا ثلاثة عملاء.
 */
export function connectOnDemand(client: ReturnType<typeof createRedisClient>): {
  readonly commands: RedisCommandsLike;
  readonly lockCommands: ReturnType<typeof adaptRedisV6ForLock>;
  readonly budgetCommands: ReturnType<typeof adaptRedisV6ForBudget>;
  readonly setNx: RedisSetNxView;
  readonly disconnect: () => Promise<void>;
} {
  // حاجز الانهيار: خطأ مقبس Redis (انقطاع البتة أثناء التشغيل) يبقى سجلاً
  // تحذيرياً لا استثناء 'error' غير معالج يُسقط العملية كلها — السلوك
  // الموثق هو فشل مغلق معلن عند الطلب (503) مع إعادة اتصال تلقائية من
  // العميل، لا موت الخادم. رسائل node-redis قد تضمّن DSN بكلمة المرور
  // فتُعقم أي روابط من السجل — بنيوي بلا أي قيم سرية.
  client.on("error", (error: Error) => {
    const scrubbed = error.message.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]*/gi, "[محجوب]");
    console.warn(JSON.stringify({ level: "warn", scope: "redis-connector", msg: "redis_connection_error", message: scrubbed }));
  });
  const ready = client.connect().catch(() => undefined);
  const live = async (): Promise<ReturnType<typeof createRedisClient>> => {
    await ready;
    return client;
  };
  const commands: RedisCommandsLike = {
    async xAdd(key, id, fields) {
      return (await live()).xAdd(key, id, fields);
    },
    async xRange(key, start, stop) {
      return (await live()).xRange(key, start, stop);
    },
    async hSet(key, field, value) {
      return (await live()).hSet(key, field, value);
    },
    async hGetAll(key) {
      return (await live()).hGetAll(key);
    },
    async expire(key, seconds) {
      return Boolean(await (await live()).expire(key, seconds));
    },
  };
  // المحولات الحية فوق العميل نفسه — القفل والميزانية يشتركان الاتصال
  // مع المخازن العرضية (لا تنفيذ موازٍ ببنية اتصال منفصلة)
  const lockCommands = adaptRedisV6ForLock(client);
  const budgetCommands = adaptRedisV6ForBudget(client);
  const setNx: RedisSetNxView = {
    async set(key, value, options) {
      return (await live()).set(key, value, options);
    },
  };
  return {
    commands,
    lockCommands,
    budgetCommands,
    setNx,
    disconnect: async () => {
      await ready;
      try {
        await client.quit();
      } catch {
        // عميل لم يعقد اتصالاً قط — لا شيء لإغلاقه
      }
    },
  };
}
