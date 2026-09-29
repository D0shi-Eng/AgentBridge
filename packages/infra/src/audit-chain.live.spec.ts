/**
 * بوابة التدقيق الحية — سلامة سلسلة التدقيق عبر "عمليتين" + عبث رباعي + مرساة.
 *
 * الشرط: AB_LIVE_AUDIT_DB_URL يشير إلى قاعدة اصطناعية مؤقتة مكتملة الهجرات
 * (قاعدة اختبار مؤقتة تُنشأ وتُسقط حول البوابة، لا migrations على قواعد دائمة).
 * غياب المتغير = NOT_RUN موثق باسمه (بيئة، لا فشل).
 *
 * تثبت: (1) اتصالان مستقلان (محاكاة عمليتين) يتنافسان على append — لا فقد
 * ولا تشعّب seq (قيد unique في القاعدة + ذرية الكتابة)؛ (2) تعديل صف
 * يكشفه verifyChain؛ (3) حذف صف يكشف؛ (4) إعادة ترقيم (reorder) تكشف؛
 * (5) مرساة checkpoint موقعة تكتشف إعادة كتابة السلسلة كاملة بعد التوقيع —
 * مستواها: كشف إعادة كتابة القاعدة، لا ادعاء tamper-proof.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HashChainAuditLog, createPrismaSemanticStore } from "./index.js";

const DATABASE_URL = process.env.AB_LIVE_AUDIT_DB_URL ?? "";

/** عميل + سجل تدقيق مستقل — يمثل عملية واحدة */
async function processOf(url: string) {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();
  return { prisma, audit: new HashChainAuditLog(createPrismaSemanticStore(prisma)), semantic: createPrismaSemanticStore(prisma) };
}

describe.sequential("بوابة التدقيق الحية (حي مشروط): سلسلة التدقيق عبر اتصالين + عبث + مرساة", () => {
  it("تنافس append عبر اتصالين يبني سلسلة سليمة، وكل صور التلاعب الأربعة تكشف", async () => {
    if (DATABASE_URL.length === 0) {
      console.warn("[NOT_RUN] AB_LIVE_AUDIT_DB_URL غير مضبوط — بوابة التدقيق الحي مؤجلة لبيئة معتمدة");
      return;
    }
    const tenantId = `audit-live-${randomUUID().slice(0, 8)}`;
    const a = await processOf(DATABASE_URL);
    const b = await processOf(DATABASE_URL);
    try {
      // (1) تنافس حقيقي: 6+6 أحداث متداخلة زمنياً من «العمليتين»
      const jobs: Array<Promise<unknown>> = [];
      for (let i = 0; i < 6; i += 1) {
        jobs.push(a.audit.record({ tenantId, runId: "run-x", stage: "analyze", decision: "event", abstractedPayload: `a-${i}`, at: new Date().toISOString() }));
        jobs.push(b.audit.record({ tenantId, runId: "run-x", stage: "analyze", decision: "event", abstractedPayload: `b-${i}`, at: new Date().toISOString() }));
      }
      const settled = await Promise.allSettled(jobs);
      // لا فقد: كل عملية append إما نجحت أو رُفضت بقيد القاعدة (تعارض seq
      // يعاد فوقه بقراءة الذيل من جديد) — المحصلة سلسلة متصلة بلا فجوات
      const chain = await b.audit.verifyChain(tenantId);
      expect(chain.ok).toBe(true);
      if (chain.ok) {
        expect(chain.value.entries).toBeGreaterThanOrEqual(10);
        expect(chain.value.entries).toBeLessThanOrEqual(12);
      }
      const failed = settled.filter((s) => s.status === "rejected");
      // أي رفض يجب أن يكون تعارض كتابة لا خطأ بنيوي
      for (const f of failed) {
        expect(String((f as PromiseRejectedResult).reason)).toMatch(/P2002|Unique|seq/u);
      }

      // رأس السلسلة الحالي — مدخل المرساة
      const head = await b.semantic.lastAuditEntry(tenantId);
      expect(head).not.toBeNull();

      // (2) تعديل صف: payload لصف أوسط → السلسلة تنكسر عند موضعه
      const rowsBefore = await b.prisma.auditLog.findMany({
        where: { tenant_id: tenantId }, orderBy: { seq: "asc" },
      });
      expect(rowsBefore.length).toBeGreaterThan(3);
      const middle = rowsBefore[Math.floor(rowsBefore.length / 2)]!;
      await b.prisma.auditLog.update({ where: { hash: middle.hash }, data: { abstracted_payload: "MALLFORMED-TAMPER" } });
      const afterEdit = await a.audit.verifyChain(tenantId);
      expect(afterEdit.ok).toBe(false);
      // إصلاح التعديل للحالات التالية
      await b.prisma.auditLog.update({ where: { hash: middle.hash }, data: { abstracted_payload: middle.abstracted_payload } });
      expect((await a.audit.verifyChain(tenantId)).ok).toBe(true);

      // (3) حذف صف أوسط → فجوة seq وانقطاع prevHash → كشف بنيوي.
      // ملاحظة أمينة: حذف الذيل كاملاً لا يكشفه فحص السلسلة الداخلي
      // بحكم التعريف (سلسلة أقصر متصلة سليمة) — كشف القص وظيفة المرساة (5)
      const middle2 = rowsBefore[Math.floor(rowsBefore.length / 2) + 1] ?? rowsBefore[1]!;
      await b.prisma.auditLog.delete({ where: { hash: middle2.hash } });
      expect((await a.audit.verifyChain(tenantId)).ok).toBe(false);
      await b.prisma.auditLog.create({ data: { ...middle2 } });
      expect((await a.audit.verifyChain(tenantId)).ok).toBe(true);

      // (4) إعادة ترقيم (صورة reorder): رفع seq صف أوسط إلى قيمة غير متسلسلة
      await b.prisma.auditLog.update({ where: { hash: middle.hash }, data: { seq: 9_999 } });
      expect((await a.audit.verifyChain(tenantId)).ok).toBe(false);
      await b.prisma.auditLog.update({ where: { hash: middle.hash }, data: { seq: middle.seq } });

      // (5) المرساة: توقيع الرأس ثم إعادة كتابة السلسلة بالكامل (قصة مدير DB)
      const { generateCheckpointMaterial, signCheckpoint, verifyCheckpoint } = await import("./audit-checkpoint.js");
      const material = generateCheckpointMaterial();
      const finalHead = await b.semantic.lastAuditEntry(tenantId);
      expect(finalHead).not.toBeNull();
      const signed = signCheckpoint(
        { tenantId, seq: finalHead!.seq, headHash: finalHead!.hash, at: new Date().toISOString() },
        material,
      );
      // إعادة كتابة كاملة: حذف كل الصفوف ثم كتابة سلسلة جديدة بعملية
      // ثالثة نظيفة الكاش (محاكاة مدير DB يعيد البناء كاملاً من الصفر)
      await b.prisma.auditLog.deleteMany({ where: { tenant_id: tenantId } });
      const c = await processOf(DATABASE_URL);
      for (let i = 0; i < 5; i += 1) {
        await c.audit.record({ tenantId, runId: "run-rewritten", stage: "certify", decision: "event", abstractedPayload: `rewritten-${i}`, at: new Date().toISOString() });
      }
      const rewrittenHead = await c.semantic.lastAuditEntry(tenantId);
      expect((await c.audit.verifyChain(tenantId)).ok).toBe(true); // السلسلة الجديدة سليمة داخلياً
      // لكن المرساة تكشف أنها ليست السلسلة التي وُقّع عليها
      const verdict = verifyCheckpoint(signed, {
        publicKey: material.publicKey,
        currentHead: { tenantId, seq: rewrittenHead!.seq, headHash: rewrittenHead!.hash, at: rewrittenHead!.at },
      });
      expect(verdict.ok && verdict.value.matchesHead).toBe(false);
    } finally {
      // تنظيف البيانات الاصطناعية فقط (بادئة المعرّف مخصصة لهذه البوابة)
      await b.prisma.auditLog.deleteMany({ where: { tenant_id: { startsWith: "audit-live-" } } }).catch(() => undefined);
      await a.prisma.$disconnect().catch(() => undefined);
      await b.prisma.$disconnect().catch(() => undefined);
    }
  }, 120_000);
});
