/**
 * اختبارات عزل RLS على مستوى الوحدة (بلا قاعدة): مزيف Prisma يثبت
 * أن كل عملية تفتح معاملة واحدة، تضبط set_config أولاً، ثم تنفذ العمل
 * على عميل المعاملة نفسه — وأن revokeSession مقيّد بالمستأجر وأن إلغاء
 * الاعتماد يلغي عضويته الداخلية وجلساته المشتقة ذرياً.
 */
import { describe, expect, it } from "vitest";
import { createPrismaAuthStore } from "./prisma-auth-store.js";
import { withLookupPrisma, withTenantPrisma } from "./prisma-scope.js";
import type { Prisma, PrismaClient } from "@prisma/client";

/** مزيف عميل: يسجل ترتيب العمليات ويمثل المعاملة بنفس الكائن */
function fakeClient() {
  const calls: string[] = [];
  const transaction: Prisma.TransactionClient = {
    $executeRawUnsafe: async (query: string, ...params: unknown[]) => {
      calls.push(`raw:${query}:${params.join(",")}`);
      return 0;
    },
    session: {
      updateMany: async (args: { where: Record<string, unknown> }) => {
        calls.push(`session.updateMany:${JSON.stringify(args.where)}`);
        return { count: 1 };
      },
    },
    externalIdentity: {
      upsert: async (args: { where: Record<string, unknown> }) => {
        calls.push(`identity.upsert:${JSON.stringify(args.where)}`);
        return {};
      },
    },
  } as unknown as Prisma.TransactionClient;
  const client = {
    $transaction: async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      calls.push("tx:begin");
      const result = await work(transaction);
      calls.push("tx:commit");
      return result;
    },
  } as unknown as PrismaClient;
  return { client, calls };
}

describe("withTenantPrisma/withLookupPrisma — البروتوكول", () => {
  it("يضبط set_config ثم ينفذ العمل داخل المعاملة نفسها بالترتيب", async () => {
    const { client, calls } = fakeClient();
    const value = await withTenantPrisma(client, "tenant-a", async (tx) => {
      await tx.$executeRawUnsafe("SELECT 1");
      return "done";
    });
    expect(value).toBe("done");
    // الترتيب الحاسم: معاملة ← set_config ← العمل ← لا شيء بينها
    expect(calls).toEqual([
      "tx:begin",
      'raw:SELECT set_config($1, $2, true):app.tenant_id,tenant-a',
      "raw:SELECT 1:",
      "tx:commit",
    ]);
  });

  it("يرفض السياق الفارغ ومفتاح lookup خارج القائمة البيضاء قبل المعاملة", async () => {
    const { client, calls } = fakeClient();
    // الرفض متزامن قبل فتح أي معاملة — فلا يوجد وعد يُنتظر أصلاً
    expect(() => withTenantPrisma(client, "", async () => undefined)).toThrow(/فارغ|غير صالح/u);
    expect(() => withLookupPrisma(client, [["app.evil", "x"]], async () => undefined)).toThrow(/غير مسموح/u);
    // لا معاملة فُتحت إطلاقاً
    expect(calls).toEqual([]);
  });

  it("lookup مسموح يضبط كل المفاتيح بنفس الترتيب داخل معاملة واحدة", async () => {
    const { client, calls } = fakeClient();
    await withLookupPrisma(client, [["app.identity_issuer", "https://i"], ["app.identity_subject", "s"]], async () => undefined);
    expect(calls[0]).toBe("tx:begin");
    expect(calls.filter((c) => c.startsWith("raw:SELECT set_config")).length).toBe(2);
    expect(calls[calls.length - 1]).toBe("tx:commit");
  });
});

describe("createPrismaAuthStore — العقد المقيد", () => {
  it("revokeSession يقيّد التحديث بالمستأجر داخل معاملة app.tenant_id", async () => {
    const { client, calls } = fakeClient();
    const store = createPrismaAuthStore(client);
    const ok = await store.revokeSession("sess-1", "tenant-a", "2026-09-07T00:00:00.000Z");
    expect(ok).toBe(true);
    expect(calls).toEqual([
      "tx:begin",
      "raw:SELECT set_config($1, $2, true):app.tenant_id,tenant-a",
      'session.updateMany:{"id":"sess-1","tenant_id":"tenant-a","revoked_at":null}',
      "tx:commit",
    ]);
  });

  it("putExternalIdentity يمر عبر بوابة identity_write في معاملة pre-auth", async () => {
    const { client, calls } = fakeClient();
    const store = createPrismaAuthStore(client);
    await store.putExternalIdentity({ identityId: "i1", issuer: "https://i", subject: "s", createdAt: "2026-09-07T00:00:00.000Z" });
    expect(calls).toContain('raw:SELECT set_config($1, $2, true):app.identity_write,1');
    expect(calls.filter((c) => c.startsWith("raw:SELECT set_config")).length).toBe(1);
  });
});
