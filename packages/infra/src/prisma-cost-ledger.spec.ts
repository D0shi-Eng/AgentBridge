/**
 * اختبارات دفتر التكلفة الدائم — PrismaCostLedger فوق PostgreSQL حي.
 *
 * مشروط: يعمل عند توفر قاعدة حية وإلا يتخطى موثقاً (لا كسر لبيئة بلا Docker).
 * يتحقق: monthSpendUsd للشهر الحالي، addSpend upsert ذري، عزل مستأجرين.
 */

import { randomUUID } from "node:crypto";
import { LIVE_DATABASE_URL } from "./live-config.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaCostLedger } from "./prisma-cost-ledger.js";
import { currentMonthKey } from "./row-mappers.js";

const DATABASE_URL =
  process.env.AB_LIVE_DATABASE_URL ?? LIVE_DATABASE_URL;

async function probeDatabase(): Promise<boolean> {
  const separator = DATABASE_URL.includes("?") ? "&" : "?";
  const probe = new PrismaClient({ datasources: { db: { url: `${DATABASE_URL}${separator}connect_timeout=2` } } });
  try {
    await probe.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.$disconnect();
  }
}

const available = await probeDatabase();
if (!available) {
  console.info(
    "[تخطٍّ موثق] اختبار PrismaCostLedger التكاملي: لا قاعدة PostgreSQL حية — أقلع docker-compose.dev.yaml أو اضبط AB_LIVE_DATABASE_URL",
  );
}

const PREFIX = `it-cost-${randomUUID().slice(0, 8)}-`;
const month = currentMonthKey();

describe.skipIf(!available)("PrismaCostLedger فوق PostgreSQL حي", () => {
  let prisma: PrismaClient;
  let ledger: ReturnType<typeof createPrismaCostLedger>;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    ledger = createPrismaCostLedger(prisma);
    tenantA = `${PREFIX}a`;
    tenantB = `${PREFIX}b`;
  });

  afterAll(async () => {
    await prisma.llmSpend.deleteMany({ where: { tenant_id: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("يبدأ بصفر ويسجل إنفاقاً ويتراكم ذرياً", async () => {
    expect(await ledger.monthSpendUsd(tenantA)).toBe(0);
    await ledger.addSpend(tenantA, 0.01);
    expect(await ledger.monthSpendUsd(tenantA)).toBeCloseTo(0.01, 5);
    await ledger.addSpend(tenantA, 0.02);
    expect(await ledger.monthSpendUsd(tenantA)).toBeCloseTo(0.03, 5);
  });

  it("يعزل المستأجرين — B لا يرى إنفاق A", async () => {
    await ledger.addSpend(tenantB, 0.05);
    expect(await ledger.monthSpendUsd(tenantB)).toBeCloseTo(0.05, 5);
    expect(await ledger.monthSpendUsd(tenantA)).toBeCloseTo(0.03, 5);
  });

  it("يستعمل المفتاح الشهري الصحيح (YYYY-MM) ويكتب صفاً واحداً لكل مستأجر/شهر", async () => {
    const rows = await prisma.llmSpend.findMany({ where: { tenant_id: tenantA } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.month).toBe(month);
    expect(rows[0]?.amount_usd).toBeCloseTo(0.03, 5);
  });
});
