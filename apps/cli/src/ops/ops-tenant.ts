/**
 * أوامر دورة حياة المستأجر — dry-run وconfirm للحذف المسوَّر، وضبط
 * الحجز القانوني، وإبطال اعتماد (نصف الدوران). كل الأوامر تحلل
 * وسائطها بقائمة مسموحة صارمة وتتطلب --store صراحة.
 */

import {
  DeletionFlowError, TenantDeletionError, confirmTenantDeletionFenced, dryRunTenantDeletion,
} from "@agentbridge/infra";
import { buildLiveStores, buildMemoryStores, type OpsStores } from "./ops-runtime.js";
import { OpsError, hasFlag, optionalOne, parseCommandArgs, requireOne, requireStore, sanitizeErrorText } from "./ops-common.js";

/** نوع وسائط محللة — يوحد التوقيع بين الأوامر */
type ParsedArgs = ReturnType<typeof parseCommandArgs>;

/** القوائم المسموحة لكل أمر — أي علم آخر يرفض */
const DELETE_SPEC = { flags: { tenant: "single", mode: "single", fence: "single", confirm: "single", store: "single" } } as const;
const HOLD_SPEC = { flags: { tenant: "single", until: "single", clear: "one", store: "single" } } as const;
const REVOKE_SPEC = { flags: { tenant: "single", credential: "single", store: "single" } } as const;

export async function runTenantDelete(argv: readonly string[]): Promise<number> {
  const args = parseCommandArgs(argv, DELETE_SPEC);
  const mode = optionalOne(args, "mode") ?? "dry-run";
  const tenantId = requireOne(args, "tenant");
  if (mode !== "dry-run" && mode !== "confirm") {
    throw new OpsError(2, `--mode غير معروفة: ${mode} — dry-run أو confirm حصراً`);
  }
  const stores = await pickStores(args);
  try {
    if (mode === "dry-run") {
      const report = await dryRunTenantDeletion({ lifecycle: stores.lifecycle, audit: stores.audit }, tenantId);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report.verdict === "READY" ? 0 : 1;
    }
    // confirm: نسيج صريح + رمز تأكيد مطابق للمعرف — السير المسوَّر يتولى الباقي
    const fence = requireOne(args, "fence");
    const confirmationToken = requireOne(args, "confirm");
    try {
      const { receipt, replayed } = await confirmTenantDeletionFenced(
        { lifecycle: stores.lifecycle, operations: stores.deletionOperations },
        tenantId, fence, confirmationToken, new Date().toISOString(),
      );
      process.stdout.write(`${JSON.stringify({ ...receipt, replayed }, null, 2)}\n`);
      // إعادة الإرسال الناجحة لا تكتب وصلاً جديداً — التوافق: نفس الخروج 0
      process.stderr.write(replayed
        ? "إعادة إرسال إيدبوتنتية: أُعيد الإيصال المخزن نفسه بلا حذف ثانٍ وبلا وصل مكرر.\n"
        : "الباقي عمداً: صفوف التدقيق، إبطالات الشهادات العامة، قبر المستأجر المُقلَّل، سجل العملية.\n");
      return 0;
    } catch (error) {
      if (error instanceof DeletionFlowError || error instanceof TenantDeletionError) {
        const code = error instanceof DeletionFlowError ? error.code : error.code;
        process.stderr.write(`رفض حذف [${code}]: ${sanitizeErrorText(error.message)}\n`);
        // التعارض الصريح فشل تشغيلي (خروج 1)؛ القبر التاريخي بلا سجل
        // (ALREADY_DELETED) حالة نهائية موثقة لا فشل — خروج 0 بوضوح
        return code === "ALREADY_DELETED" ? 0 : 1;
      }
      throw error;
    }
  } finally {
    await stores.close();
  }
}

export async function runLegalHold(argv: readonly string[]): Promise<number> {
  const args = parseCommandArgs(argv, HOLD_SPEC);
  const tenantId = requireOne(args, "tenant");
  const clear = hasFlag(args, "clear");
  const untilIso = clear ? null : requireOne(args, "until");
  if (untilIso !== null && Number.isNaN(Date.parse(untilIso))) {
    throw new OpsError(2, `--until يجب أن يكون توقيت ISO صالحاً: ${untilIso}`);
  }
  const stores = await pickStores(args);
  try {
    await stores.lifecycle.setTenantLegalHold(tenantId, untilIso);
    process.stdout.write(`${JSON.stringify({ tenantId, legalHoldUntil: untilIso }, null, 2)}\n`);
    return 0;
  } finally {
    await stores.close();
  }
}

export async function runCredentialRevoke(argv: readonly string[]): Promise<number> {
  const args = parseCommandArgs(argv, REVOKE_SPEC);
  const tenantId = requireOne(args, "tenant");
  const credentialId = requireOne(args, "credential");
  const stores = await pickStores(args);
  try {
    const existing = await stores.auth.findApiCredential(credentialId);
    if (existing === null || existing.tenantId !== tenantId) {
      process.stderr.write(`اعتماد غير موجود داخل المستأجر: ${credentialId}\n`);
      return 1;
    }
    if (existing.revokedAt !== undefined) {
      process.stderr.write(`الاعتماد ملغى سابقاً (${existing.revokedAt}) — الإبطال idempotent\n`);
      return 0;
    }
    const atIso = new Date().toISOString();
    await stores.auth.putApiCredential({ ...existing, revokedAt: atIso });
    await stores.audit.record({
      tenantId, runId: `credential-revoked:${credentialId}`, stage: "credential_rotation", decision: "revoked",
      abstractedPayload: JSON.stringify({ event: "credential.revoked", credentialId, subjectId: existing.subjectId }),
      at: atIso,
    });
    process.stdout.write(`${JSON.stringify({ credentialId, revokedAt: atIso }, null, 2)}\n`);
    return 0;
  } finally {
    await stores.close();
  }
}

/** يختار بيئة التشغيل — --store إلزامية صراحة ولا fallback صامت */
async function pickStores(args: ParsedArgs): Promise<OpsStores> {
  const store = requireStore(args);
  if (store === "live") return buildLiveStores();
  if (process.env.NODE_ENV === "production") {
    throw new OpsError(2, "النمط memory مرفوض في الإنتاج — استخدم --store live فوق PostgreSQL حقيقية");
  }
  return buildMemoryStores();
}
