/**
 * مستكشف البنية الحية لاختبارات e2e — بينغ حقيقي بمهلة صارمة لا مجرد
 * فتح منفذ: بروكسي Docker المتوقف قد يقبل الاتصال ثم يصمت إلى ما لا نهاية.
 * يعيد true فقط حين يجيب PostgreSQL وRedis فعلاً خلال المهلة.
 */
import { createConnection } from "node:net";
import { LIVE_DATABASE_URL } from "./live-config.js";
import { PrismaClient } from "@prisma/client";
import { createClient } from "redis";

export const DATABASE_URL =
  LIVE_DATABASE_URL;
export const REDIS_URL = process.env.AB_LIVE_REDIS_URL ?? "redis://localhost:6380";

/** فتح منفذ بمهلة — خط أول سريع يكشف الرفض الفوري */
function portOpen(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
  });
}

/** مهلة قصوى لأي وعد — الحارس ضد كل شكل من الصمت الشبكي */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

export async function probeLiveInfrastructure(): Promise<boolean> {
  try {
    const db = new URL(DATABASE_URL);
    const redis = new URL(REDIS_URL);
    if (!(await portOpen(db.hostname, Number(db.port) || 5432))) return false;
    if (!(await portOpen(redis.hostname, Number(redis.port) || 6379))) return false;

    // بينغ PostgreSQL فعلي بسقف اتصال صريح في العنوان نفسه
    const separator = DATABASE_URL.includes("?") ? "&" : "?";
    const prisma = new PrismaClient({ datasources: { db: { url: `${DATABASE_URL}${separator}connect_timeout=2&pool_timeout=2` } } });
    try {
      if ((await withTimeout(prisma.$queryRaw`SELECT 1`, 4000)) === null) return false;
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }

    // بينغ Redis فعلي بمهلة مزدوجة (اتصال + أمر)
    const client = createClient({ url: REDIS_URL, socket: { connectTimeout: 1500 } });
    try {
      if ((await withTimeout(client.connect(), 2500)) === null) return false;
      if ((await withTimeout(client.ping(), 1500)) === null) return false;
      return true;
    } finally {
      await client.quit().catch(() => undefined);
    }
  } catch {
    return false;
  }
}
