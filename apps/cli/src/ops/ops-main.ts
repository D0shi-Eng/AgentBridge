/**
 * نقطة دخول `agentbridge-ops` — أوامر الإدارة المحلية:
 * onboard-tenant · tenant-delete · legal-hold · credential-revoke ·
 * retention-sweep. غلاف رفيع يوزع على وحدات الأوامر ويربط رمز الخروج.
 * لا endpoint عام — الإدارة من جهاز التشغيل حصراً. اتصالات قاعدة
 * البيانات عبر البيئة أو ملف سر حصراً — لا DSN في الوسائط أو help.
 */

import { OpsError } from "./ops-common.js";
import { runOnboardTenant } from "./ops-onboard.js";
import { runCredentialRevoke, runLegalHold, runTenantDelete } from "./ops-tenant.js";
import { runRetentionSweepCommand } from "./ops-retention.js";

const USAGE = `agentbridge-ops — أوامر الإدارة المحلية

الأوامر (كلها تتطلب --store memory|live صراحة — لا افتراض صامت):
  onboard-tenant --tenant <id> --name <اسم> --issuer <url> --subject <sub>
                 --permissions <قائمة-بفواصل> --expires-in-days <1-730>
                 [--initial 1] [--secret-output <مسار-ملف-جديد>]
  tenant-delete  --tenant <id> [--mode dry-run|confirm] --fence <مفتاح> --confirm <id>
  legal-hold     --tenant <id> --until <iso> | --clear 1
  credential-revoke --tenant <id> --credential <id>
  retention-sweep --tenant <id> [--tenant <id2>…] [--policy <ملف.json>]

الاتصال الحي: DATABASE_URL عبر البيئة إلزامي، واتصال الإدارة لحارس
bootstrap الأول عبر ADMIN_DATABASE_URL أو ADMIN_DATABASE_URL_FILE —
لا وسائط أوامر ولا اتصالات مطبوعة إطلاقاً.
المفتاح الخام من onboarding يظهر حصراً عبر --secret-output <مسار> (ملف
جديد بإنشاء ذري) أو على TTY تفاعلي مرة واحدة — الأنابيب تُرفض.`;

async function dispatch(argv: readonly string[]): Promise<number> {
  const [command = "", ...rest] = argv;
  if (command === "" || command === "help" || command === "--help") {
    process.stdout.write(`${USAGE}\n`);
    return command === "" ? 2 : 0;
  }
  switch (command) {
    case "onboard-tenant": return runOnboardTenant(rest);
    case "tenant-delete": return runTenantDelete(rest);
    case "legal-hold": return runLegalHold(rest);
    case "credential-revoke": return runCredentialRevoke(rest);
    case "retention-sweep": return runRetentionSweepCommand(rest);
    default:
      throw new OpsError(2, `أمر غير معروف: ${command} — شغّل help لعرض الأوامر`);
  }
}

try {
  process.exit(await dispatch(process.argv.slice(2)));
} catch (error) {
  if (error instanceof OpsError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(error.exitCode);
  }
  process.stderr.write(`فشل غير متوقع: ${String((error as { message?: string }).message ?? error)}\n`);
  process.exit(1);
}
