/**
 * أدوات مشتركة لأوامر التشغيل الإداري — تحليل وسائط صارم وإخراج
 * آمن للأسرار وأخطاء موحدة برموز خروج مستقرة.
 *
 * قواعد الأمان الثابتة هنا:
 * - لا shell ولا قراءة أسرار من وسائط الأوامر: الاتصالات عبر متغيرات
 *   البيئة أو ملف سر صريح فقط (القاعدة 15) — ولا DSN يظهر في help أو
 *   الأخطاء أو process list.
 * - المفتاح الخام لا يُطبع إلا عبر قناة معتمدة واحدة: ملف صريح بمخرج
 *   `--secret-output` (إنشاء ذري بلا overwrite وصلاحيات مقيدة) أو عرض
 *   TTY تفاعلي مرة واحدة؛ أما stdout غير التفاعلي فبيرفض fail-closed
 *   كي لا يلتقط مشغّل الأدلة السر في سجل التشغيل.
 * - كل نص خطأ يمر عبر تنقية تنزع سلاسل الاتصال قبل الطباعة.
 */

import { openSync, closeSync, writeSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";

/** خطأ تشغيلي برمز خروج — الرسائل عربية محددة للمشغّل */
export class OpsError extends Error {
  constructor(readonly exitCode: number, message: string) {
    super(message);
  }
}

/** أنواع الوسائط المسموحة لكل علم: قيمة مفردة، قيم متعددة، أو "1" حصراً */
export type FlagKind = "single" | "multi" | "one";

/** مواصفة أمر إداري: القائمة المسموحة بلا أي علم زائد */
export interface CommandSpec {
  readonly flags: Readonly<Record<string, FlagKind>>;
}

/**
 * يحلل الوسائط صارماً: أي علم خارج القائمة المسموحة يرفض، أي تكرار
 * لعلم non-multi يرفض، وأي علم بلا قيمة يرفض — لا افتراضات صامتة.
 * القيمة "1" إلزامية للأعلام المنطقية (`--initial 1`) فتوحّد الكود
 * والتوثيق على صيغة واحدة.
 */
export function parseCommandArgs(argv: readonly string[], spec: CommandSpec): Map<string, string[]> {
  const args = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      throw new OpsError(2, `وسيطة موضعية غير مقبولة: ${arg} — الصيغة --flag value فقط`);
    }
    const key = arg.slice(2);
    const kind = spec.flags[key];
    if (kind === undefined) {
      const allowed = Object.keys(spec.flags).map((k) => `--${k}`).join(" ");
      throw new OpsError(2, `علم غير معروف: --${key} — الأعلام المسموحة: ${allowed}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new OpsError(2, `الوسيطة --${key} تتطلب قيمة`);
    }
    if (kind === "one" && value !== "1") {
      throw new OpsError(2, `الوسيطة --${key} علم منطقي صريح — قيمته المقبولة "1" حصراً لا "${value}"`);
    }
    const current = args.get(key) ?? [];
    if (kind !== "multi" && current.length > 0) {
      throw new OpsError(2, `الوسيطة --${key} مكررة — قيمة واحدة بالضبط`);
    }
    current.push(value);
    args.set(key, current);
    i += 1;
  }
  return args;
}

/** يقرأ قيمة إلزامية مفردة */
export function requireOne(args: Map<string, string[]>, key: string): string {
  const values = args.get(key);
  if (values === undefined || values.length !== 1 || values[0] === undefined || values[0].length === 0) {
    throw new OpsError(2, `--${key} مطلوبة بقيمة واحدة بالضبط`);
  }
  return values[0];
}

/** يقرأ قيمة اختيارية مفردة */
export function optionalOne(args: Map<string, string[]>, key: string): string | undefined {
  const values = args.get(key);
  return values !== undefined && values.length === 1 ? values[0] : undefined;
}

/** يتحقق من وجود علم منطقي بصيغة `--flag 1` الموحدة */
export function hasFlag(args: Map<string, string[]>, key: string): boolean {
  return args.get(key)?.includes("1") === true;
}

/**
 * يقرأ ويصادق على `--store`: إلزامية صراحة لأوامر الإدارة كلها — لا
 * fallback صامت إلى memory ولا إلى live. القيمتين المقبولتين
 * memory|live حصراً.
 */
export function requireStore(args: Map<string, string[]>): "memory" | "live" {
  const store = requireOne(args, "store");
  if (store !== "memory" && store !== "live") {
    throw new OpsError(2, `--store تقبل memory أو live حصراً — القيمة المرفوضة: ${store}`);
  }
  return store;
}

/** نمط DSN الذي تنزعه التنقية من أي نص خطأ قبل عرضه للمشغّل */
const DSN_PATTERN = /(postgres(ql)?|redis):\/\/[^\s"']+/giu;

/** ينزع سلاسل الاتصال من نص خطأ — لا DSN في stderr أو التقارير */
export function sanitizeErrorText(text: string): string {
  return text.replace(DSN_PATTERN, "[اتصال-منقوح]");
}

/**
 * يكتب محتوى سري إلى ملف صريح بإنشاء ذري (O_EXCL) — يرفض الكتابة فوق
 * ملف موجود، ويقيّد الصلاحيات للمستخدم الحالي قدر إمكانيات المنصة
 * (icacls على Windows، chmod 600 على POSIX). يعيد المسار المطلق.
 */
export function writeSecretFileExclusive(path: string, content: string): string {
  let fd: number;
  try {
    // "wx" = إنشاء حصراً: فشل صريح إن وُجد الملف — لا overwrite أبداً
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "EEXIST") {
      throw new OpsError(2, `ملف المخرج السري موجود مسبقاً — رفض الكتابة فوقه: ${path} (احذفه عمداً أو اختر مساراً جديداً)`);
    }
    throw new OpsError(2, `تعذر إنشاء ملف المخرج السري: ${sanitizeErrorText(String((error as Error).message ?? error))}`);
  }
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  restrictFileAcl(path);
  return path;
}

/** يقيد صلاحيات ملف سر للمستخدم الحالي — تقريب ممكن لا ضمان مطلق */
function restrictFileAcl(path: string): void {
  if (process.platform === "win32") {
    // وراثة معطلة ثم منح المستخدم الحالي فقط — نتيجة icacls تفحص لاحقاً في الاختبارات
    const user = process.env.USERNAME ?? "";
    const result = spawnSync("icacls", [path, "/inheritance:r", "/grant:r", `${user}:F`], { shell: false, timeout: 10_000 });
    if (result.status !== 0) {
      process.stderr.write("تحذير: تعذر تقييد ACL ملف السر آلياً — قيده يدوياً بعد الجلسة\n");
    }
    return;
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    process.stderr.write("تحذير: تعذر ضبط chmod 600 لملف السر\n");
  }
}

/** تعليمات ما بعد الإصدار — بلا أي سر ولا صيغة تحمل السر */
export interface SecretDisclosure {
  readonly secret: string;
  readonly credentialId: string;
  readonly expiresAt: string;
  readonly auditCorrelationId: string;
  readonly secretOutputPath?: string;
}

/**
 * القناة الآمنة الوحيدة لإظهار المفتاح الخام:
 * - مع `--secret-output`: يكتب الملف ذرياً بلا overwrite، ويطبع
 *   التعليمات والمعرفات بلا أي سر في stdout/stderr.
 * - بلا ذلك وعلى TTY تفاعلي: يطبع المفتاح مرة واحدة على stdout حصراً،
 *   والتعليمات على stderr — ولا يطبع أي سطر Authorization يحمل السر.
 * - بلا ذلك وعلى stdout غير تفاعلي (أنبوب/التقاط أدلة): رفض fail-closed
 *   حتى لا يسرَب المفتاح إلى سجل تشغيل.
 */
export function discloseSecret(disclosure: SecretDisclosure): void {
  const meta = [
    `credentialId=${disclosure.credentialId}`,
    `expiresAt=${disclosure.expiresAt}`,
    `auditCorrelationId=${disclosure.auditCorrelationId}`,
    "المخزن يحفظ hash scrypt حصراً — المفتاح الخام أعلاه لا يعاد أبداً.",
  ];
  if (disclosure.secretOutputPath !== undefined) {
    writeSecretFileExclusive(
      disclosure.secretOutputPath,
      `# مفتاح onboarding الخام — مكتوب ذرياً مرة واحدة بواسطة agentbridge-ops\nAGENTBRIDGE_RAW_API_KEY=${disclosure.secret}\n`,
    );
    process.stdout.write(`كُتب المفتاح الخام إلى: ${disclosure.secretOutputPath}\n`);
    for (const line of meta) process.stdout.write(`${line}\n`);
    process.stdout.write("صيغة الاستخدام: Authorization: Bearer <credentialId>.<المفتاح-الخام-من-الملف>\n");
    return;
  }
  if (process.stdout.isTTY !== true) {
    throw new OpsError(2, "stdout غير تفاعلي — رفض طباعة المفتاح الخام في أنبوب التقاط؛ أعد التشغيل مع --secret-output <مسار> لملف صريح");
  }
  process.stdout.write(`${disclosure.secret}\n`);
  for (const line of meta) process.stderr.write(`${line}\n`);
  process.stderr.write("صيغة الاستخدام: Authorization: Bearer <credentialId>.<المفتاح-الخام-أعلاه>\n");
}
