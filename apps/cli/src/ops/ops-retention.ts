/**
 * أمر `retention-sweep` — مسح احتفاظ بنطاق مستأجر معلن، مع وصل تدقيق
 * على سلسلة كل مستأجر. قائمة المستأجرين إلزامية — لا مسح شامل بلا سياق.
 */

import { readFileSync } from "node:fs";
import { DEV_RETENTION_POLICY, RetentionPolicySchema, runRetentionSweep, type RetentionSweepPort } from "@agentbridge/infra";
import type { RetentionPolicy } from "@agentbridge/infra";
import { buildLiveStores, buildMemoryStores, type OpsStores } from "./ops-runtime.js";
import { OpsError, optionalOne, parseCommandArgs, requireStore } from "./ops-common.js";

/** القائمة المسموحة لأمر المسح — --tenant القابلة للتكرار وحدها */
const SWEEP_SPEC = { flags: { tenant: "multi", policy: "single", store: "single" } } as const;

export async function runRetentionSweepCommand(argv: readonly string[]): Promise<number> {
  const args = parseCommandArgs(argv, SWEEP_SPEC);
  const tenantIds = args.get("tenant") ?? [];
  if (tenantIds.length === 0) {
    throw new OpsError(2, "متطلب --tenant واحد على الأقل — لا مسح شامل بلا سياق (FORCE RLS)");
  }
  const policy = loadPolicy(optionalOne(args, "policy"));
  const stores = await pickStores(args);
  try {
    const port = sweepPortOf(stores);
    // مسح لكل مستأجر على حدة ووصل النتيجة على سلسلة تدقيق المستأجر نفسه
    for (const tenantId of tenantIds) {
      const result = await runRetentionSweep(port, policy, [tenantId], new Date().toISOString());
      await stores.audit.record({
        tenantId, runId: `retention-sweep:${result.startedUtc}`, stage: "retention_sweep", decision: "completed",
        abstractedPayload: JSON.stringify({ event: "retention.sweep", classes: result.classes }),
        at: result.finishedUtc,
      });
      process.stdout.write(`${JSON.stringify({ ...result, tenantId }, null, 2)}\n`);
    }
    return 0;
  } finally {
    await stores.close();
  }
}

/** يحمّل السياسة من ملف JSON أو يعيد سياسة التطوير بتحذير صريح */
function loadPolicy(policyPath: string | undefined): RetentionPolicy {
  if (policyPath === undefined) {
    process.stderr.write("تحذير: بلا --policy تُستخدم سياسة التطوير — الإنتاج يتطلب RETENTION_POLICY_JSON معلنة\n");
    return DEV_RETENTION_POLICY;
  }
  const parsed = RetentionPolicySchema.safeParse(JSON.parse(readFileSync(policyPath, "utf8")));
  if (!parsed.success) {
    throw new OpsError(2, `ملف السياسة ليس سياسة احتفاظ سليمة: ${parsed.error.issues[0]?.path.join(".") ?? "?"}`);
  }
  return parsed.data;
}

/** يكيف مخازن التشغيل إلى منفذ المسح — كل عملياته بنطاق مستأجر */
function sweepPortOf(stores: OpsStores): RetentionSweepPort {
  return {
    purgeExpiredArtifacts: (t, c) => stores.lifecycle.purgeExpiredArtifacts(t, c),
    purgeExpiredSessions: (t, c) => stores.lifecycle.purgeExpiredSessions(t, c),
    purgeExpiredLoginTransactions: (t, c) => stores.lifecycle.purgeExpiredLoginTransactions(t, c),
    purgeExpiredRunArchives: (t, c) => stores.archives.purgeExpiredBefore(t, c),
    purgeExpiredVectorEmbeddings: (t, c) => stores.lifecycle.purgeExpiredVectorEmbeddings(t, c),
    purgeExpiredFlywheelLessons: (t, c) => stores.lifecycle.purgeExpiredFlywheelLessons(t, c),
  };
}

/** يختار بيئة التشغيل — --store إلزامية صراحة ولا fallback صامت */
async function pickStores(args: ReturnType<typeof parseCommandArgs>): Promise<OpsStores> {
  const store = requireStore(args);
  if (store === "live") return buildLiveStores();
  if (process.env.NODE_ENV === "production") {
    throw new OpsError(2, "النمط memory مرفوض في الإنتاج — استخدم --store live فوق PostgreSQL حقيقية");
  }
  return buildMemoryStores();
}
