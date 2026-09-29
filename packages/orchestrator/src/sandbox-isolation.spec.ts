/**
 * اختبارات عزل sandbox: تسعة سيناريوهات صغيرة
 * تثبت الرفض فعلياً داخل الحاوية بلا إنهاك الجهاز (probes محدودة الحجم
 * والزمن). كلها مشروطة بتوافر Docker — غيابه = تخطٍّ موثق باسمه.
 *
 * القيود المطبقة في كل تشغيل: network none، read-only، user 65532،
 * cap-drop ALL، no-new-privileges، seccomp مخصص، tmpfs محدودان،
 * cpus/memory/pids، واسم ab-sandbox- للتنظيف الانتقائي.
 */

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { DEFAULT_SANDBOX_OPTIONS } from "./nodes/sandbox-probes.js";

const IMAGE = "agentbridge/sandbox-runner:isolated";

function dockerAvailable(): boolean {
  const probe = spawnSync("docker", ["info", "--format", "ok"], { encoding: "utf8", timeout: 15_000, shell: false });
  return (probe.stdout ?? "").includes("ok");
}

/** فحص التوافر مرة واحدة على مستوى الوصف — غياب
 * Docker يعني تخطياً مُسمّى في العدادات لا «نجاحاً» صامتاً بلا عمل */
const dockerUp = dockerAvailable();

/** يقلع الحاوية المقيدة بأمر واحد ويعيد النتيجة — بلا shell إطلاقاً.
 * فشل الاتصال بدايمون Docker (بيئة) يعود برمز -125 المميز — التفريق
 * إلزامي بين فشل اختبار وفشل بيئة */
function runConstrained(args: readonly string[], timeoutMs = 60_000): { status: number; stdout: string; envBlocked: boolean } {
  const run = spawnSync(
    "docker",
    [
      "run", "--rm", "--name", "ab-sandbox-iso-probe", "--network", "none", "--read-only",
      "--user", "65532:65532", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--security-opt", `seccomp=${DEFAULT_SANDBOX_OPTIONS.seccompProfilePath}`,
      "--tmpfs", "/work:rw,size=64m,noexec,nosuid,uid=65532,gid=65532",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m,uid=65532,gid=65532",
      "--cpus", "1", "--memory", "512m", "--memory-swap", "512m", "--pids-limit", "64", // سقف صلب بلا swap إضافي
      "-i", IMAGE,
      ...args,
    ],
    { encoding: "utf8", timeout: timeoutMs, shell: false, input: "",
      // مهلة المضيف تقتل docker CLI قتلاً حاسماً: SIGTERM الافتراضي لا يوقف
      // docker run الملتصقاً بمخرجات الحاوية على لينكس فيكمل حتى نهاية الأمر
      killSignal: "SIGKILL" },
  );
  const stderr = run.stderr ?? "";
  const envBlocked = run.status !== 0 && (stderr.includes("docker API") || stderr.includes("dockerDesktopLinuxEngine") || stderr.includes("cannot find the file specified"));
  return { status: run.status ?? -1, stdout: run.stdout ?? "", envBlocked };
}

function expectFailure(result: { status: number; stdout: string }, label: string): void {
  // الرفض يظهر برمز خروج غير صفري — لا نجاح صامت لأي محاولة اختراق
  expect(result.status, `${label}: توقّعنا رفضاً ولم يحدث`).not.toBe(0);
}

/** بوابة موحدة: تجاوز صامت ممنوع — فقدان الدايمون أثناء التشغيل يرمي
 * خطأ NOT_RUN مسمى فيفشل البوابة بصدق لا يمرر «نجاحاً» بلا عمل */
function failIfEnvBlocked(result: { envBlocked: boolean }, label: string): void {
  if (result.envBlocked) {
    throw new Error(`NOT_RUN ENVIRONMENT_BLOCKED: ${label} — دايمون Docker سقط أثناء التشغيل، يعاد في بيئة مستقرة`);
  }
}

describe.skipIf(!dockerUp).sequential("عزل sandbox — السيناريوهات التسعة", () => {
  it("0) الصورة موجودة والقيود مفروضة في الأداة نفسها", () => {
    // بوابة fail-closed لوجود الصورة: غيابها يجعل docker run يرجع 125
    // فتمر سيناريوهات الرفض إفراغاً (nonzero = «رفض») ويفشل سيناريوهات
    // النجاح بصدق — وجود الصورة شرط صحة الجناح لا رفاهية
    const inspect = spawnSync("docker", ["image", "inspect", "--format", "ok", IMAGE], { encoding: "utf8", timeout: 15_000, shell: false });
    expect(
      (inspect.stdout ?? "").trim(),
      "صورة العزل agentbridge/sandbox-runner:isolated غير مبنية على هذه البيئة — ابنها قبل الجناح (docker build -t agentbridge/sandbox-runner:isolated docker/sandbox-runner) وإلا مرّت سيناريوهات الرفض إفراغاً",
    ).toBe("ok");
    // فحص fail-closed: profile بلا حجب mount يمنع التشغيل كله (مغطى في sandbox-probes)
    expect(DEFAULT_SANDBOX_OPTIONS.seccompProfilePath.length).toBeGreaterThan(5);
  });

  it("1) قراءة ملف خارج النطاق تُرفض (/etc/shadow)", () => {
    const r = runConstrained(["cat", "/etc/shadow"]);
    failIfEnvBlocked(r, "سيناريو 1: منع القراءة الخارجية");
    expectFailure(r, "قراءة خارج /work");
  });

  it("2) أسرار المنصة غير موجودة داخل الحاوية إطلاقاً", () => {
    const result = runConstrained(["node", "-e", "const v = Object.entries(process.env).filter(([k]) => /SECRET|TOKEN|PRIVATE|PASSWORD|AB_|ORCH_/i.test(k)); console.log(String(v.length)); process.exit(v.length === 0 ? 0 : 3)"]);
    failIfEnvBlocked(result, "سيناريو 2: فحص الأسرار");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("0");
  });

  it("3) الاتصال بوجهة ممنوعة (metadata/خارجي) يفشل — network none", () => {
    const result = runConstrained(["node", "-e", "const net = require('node:net'); const s = net.connect({ host: '169.254.169.254', port: 80, timeout: 2000 }); s.on('connect', () => { console.log('CONNECTED'); process.exit(3); }); s.on('error', () => process.exit(0)); s.on('timeout', () => process.exit(0));"]);
    failIfEnvBlocked(result, "سيناريو 3: منع الاتصال الخارجي");
    expect(result.status).toBe(0);
  });

  it("4) الكتابة في filesystem المحمية تُرفض (read-only)", () => {
    const r = runConstrained(["touch", "/usr/bin/ab-sandbox-escape-probe"]);
    failIfEnvBlocked(r, "سيناريو 4: منع الكتابة المحمية");
    expectFailure(r, "كتابة في /usr/bin");
  });

  it("5) syscall ممنوع يُحجب بـseccomp (mount)", () => {
    const r = runConstrained(["busybox", "mount", "-t", "tmpfs", "none", "/mnt"]);
    failIfEnvBlocked(r, "سيناريو 5: حجب mount");
    expectFailure(r, "mount داخل الحاوية");
  });

  it("6) مهلة المضيف تقتل التشغيل وrm -f ينظف الحاوية بلا بقايا", () => {
    // ضمانة المنصة الفعلية: المضيف يفرض المهلة (قتل docker CLI عبر
    // spawnSync timeout) ثم rm -f يمسح الحاوية — نمط sandbox-probes
    // نفسه. سلوك busybox timeout كـPID1 داخل الحاوية غير موثوق عبر
    // البيئات (أعاد 0 بعد انتهاء sleep كاملاً على نواة CI) فليس معياراً.
    const started = Date.now();
    const result = runConstrained(["sleep", "30"], 5_000);
    const elapsed = Date.now() - started;
    failIfEnvBlocked(result, "سيناريو 6: مهلة المضيف");
    expect(elapsed < 20_000).toBe(true); // انتهى بالمهلة لا بانتهاء sleep
    expect(result.status === 0).toBe(false); // القتل بالمهلة ليس نجاحاً
    // التنظيف الصريح نمط المنصة: rm -f ثم لا حاوية باقية بالاسم المميز
    const removed = spawnSync("docker", ["rm", "-f", "ab-sandbox-iso-probe"], { encoding: "utf8", timeout: 15_000, shell: false });
    expect(removed.status).toBe(0);
    const inspect = spawnSync("docker", ["inspect", "ab-sandbox-iso-probe"], { encoding: "utf8", timeout: 15_000, shell: false });
    expect(inspect.status).not.toBe(0);
  });

  it("7) تجاوز سقف الذاكرة (512MB) يُقتل بحد الحاوية — حمل محدود ومقصود", () => {
    // تخصيص متدرج 32MB لكل خطوة حتى 640MB — يقتل عند الحد داخل الحاوية
    // محدودة الحصص أصلاً — بلا ضغط على المضيف
    const result = runConstrained(["node", "-e", "const chunks = []; const step = 32 * 1024 * 1024; for (let i = 0; i < 20; i++) { chunks.push(Buffer.alloc(step, 1)); } console.log('no-oom'); process.exit(0);"], 90_000);
    failIfEnvBlocked(result, "سيناريو 7: سقف الذاكرة");
    expect(result.status).not.toBe(0);
    expect(result.stdout.includes("no-oom")).toBe(false);
  });

  it("8) الإلغاء الخارجي نظيف: rm -f يزيل الحاوية فوراً", () => {
    const started = spawnSync("docker", ["run", "-d", "--name", "ab-sandbox-iso-cancel", "--network", "none", "--read-only", "--user", "65532:65532", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--security-opt", `seccomp=${DEFAULT_SANDBOX_OPTIONS.seccompProfilePath}`, IMAGE, "sleep", "300"], { encoding: "utf8", timeout: 30_000, shell: false });
    failIfEnvBlocked({ envBlocked: started.status !== 0 && (started.stderr ?? "").includes("docker API") }, "سيناريو 8: الإلغاء الخارجي");
    const removed = spawnSync("docker", ["rm", "-f", "ab-sandbox-iso-cancel"], { encoding: "utf8", timeout: 30_000, shell: false });
    expect(removed.status).toBe(0);
    const inspect = spawnSync("docker", ["inspect", "ab-sandbox-iso-cancel"], { encoding: "utf8", timeout: 15_000, shell: false });
    expect(inspect.status).not.toBe(0);
  });

  it("9) التنظيف بعد النجاح والفشل: لا حاويات ab-sandbox- متبقية", () => {
    const list = spawnSync("docker", ["ps", "-a", "--filter", "name=ab-sandbox-", "--format", "{{.Names}}"], { encoding: "utf8", timeout: 15_000, shell: false });
    expect((list.stdout ?? "").trim()).toBe("");
  });
});
