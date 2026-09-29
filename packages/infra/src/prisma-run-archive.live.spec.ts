/**
 * اختبار أرشفة حالة التشغيل فوق Postgres حي (مشروط).
 *
 * شرط التشغيل: متغير AB_LIVE_ARCHIVE_DB_URL يشير إلى قاعدة اصطناعية مؤقتة
 * مكتملة الهجرات (قاعدة اختبار مؤقتة تُنشأ وتُمسح حول الاختبار —
 * لا migrations على أي قاعدة دائمة من هنا). غياب المتغير = تخطٍّ موثق.
 * يثبت: شرط التصاعد (generation/fence) يفرض في SQL نفسها — كتابة مالك
 * قديم ترفض من قاعدة البيانات لا من العملية.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPrismaRunArchiveStore } from "./prisma-run-archive.js";

const DATABASE_URL = process.env.AB_LIVE_ARCHIVE_DB_URL ?? "";

describe.sequential("حي: أرشفة L2 فوق Postgres (مشروط بقاعدة اصطناعية)", () => {
  it("شرط التصاعد في SQL: الرائد يُقبل والقديم يُرفض من القاعدة", async () => {
    if (DATABASE_URL.length === 0) {
      console.warn("[NOT_RUN] AB_LIVE_ARCHIVE_DB_URL غير مضبوط — اختبار الأرشفة الحي مؤجل لبيئة معتمدة");
      return;
    }
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    try {
      await prisma.$connect();
      const store = createPrismaRunArchiveStore(prisma);
      const tenantId = `archive-live-${randomUUID().slice(0, 8)}`;
      const runId = "run-live-1";

      // أول أرشفة تُقبل
      const first = await store.archive({ tenantId, runId, snapshotJson: "{\"g\":1}", generation: 1, fence: 2 });
      expect(first.ok).toBe(true);
      // نفس الجيل بـfence أقل → رفض من SQL
      const staleFence = await store.archive({ tenantId, runId, snapshotJson: "{\"g\":1}", generation: 1, fence: 1 });
      expect(staleFence.ok).toBe(false);
      if (!staleFence.ok) expect(staleFence.error.code).toBe("STALE_ARCHIVE_WRITE");
      // جيل أقل مهما بلغ fence → رفض
      const staleGen = await store.archive({ tenantId, runId, snapshotJson: "{}", generation: 0, fence: 99 });
      expect(staleGen.ok).toBe(false);
      // جيل أعلى → يقبل ويستبدل
      const newer = await store.archive({ tenantId, runId, snapshotJson: "{\"g\":2}", generation: 2, fence: 5 });
      expect(newer.ok).toBe(true);
      const latest = await store.latest(tenantId, runId);
      expect(latest?.generation).toBe(2);
      expect(latest?.fence).toBe(5);
      // عزل المستأجر: مستأجر آخر يرى null
      expect(await store.latest(`${tenantId}-other`, runId)).toBeNull();
      // تنظيف البيانات الاصطناعية
      await prisma.runStateArchive.deleteMany({ where: { tenant_id: { startsWith: "archive-live-" } } });
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  }, 30_000);
});
