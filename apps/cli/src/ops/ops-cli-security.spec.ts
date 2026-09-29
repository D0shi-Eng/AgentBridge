/**
 * اختبارات أمان CLI الإداري — إقلاع عمليات `agentbridge-ops`
 * حقيقية والتحقق من: عدم ظهور المفتاح الخام في stdout/stderr/وسائط
 * العملية، والكتابة الذرية لملف السر بلا overwrite، ورفض الأنابيب،
 * وصرامة تحليل الوسائط (allowlist/تكرار/قيم مخالفة/أخطاء إملائية).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OPS_MAIN = fileURLToPath(new URL("./ops-main.ts", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

interface RunResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly args: readonly string[];
}

/** يقلع agentbridge-ops كعملية حقيقية عبر tsx — نفس مسار التشغيل الفعلي */
function runOps(args: readonly string[], env?: Record<string, string>): RunResult {
  const result = spawnSync(process.execPath, ["--import", "tsx", OPS_MAIN, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, NODE_ENV: "development", ...env },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    args,
  };
}

let workDir: string;
beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "ops-cli-"));
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function onboardArgs(secretOutput: string): string[] {
  return [
    "onboard-tenant",
    "--tenant", "ops-cli-tenant",
    "--name", "مستأجر فحص CLI",
    "--issuer", "https://idp.ops.test",
    "--subject", "ops-owner-1",
    "--permissions", "resource:read",
    "--expires-in-days", "30",
    "--store", "memory",
    "--secret-output", secretOutput,
  ];
}

describe("إخراج المفتاح الخام بآمنة", () => {
  it("يكتب المفتاح حصراً في ملف --secret-output ولا يظهر في stdout/stderr/وسائط", () => {
    const secretFile = join(workDir, "secret-1.env");
    const run = runOps(onboardArgs(secretFile));
    expect(run.status).toBe(0);
    // الملف موجود وبه المفتاح بصيغة AGENTBRIDGE_RAW_API_KEY
    expect(existsSync(secretFile)).toBe(true);
    const content = readFileSync(secretFile, "utf8");
    const rawKey = content.match(/AGENTBRIDGE_RAW_API_KEY=(.+)\n/u)?.[1] ?? "";
    expect(rawKey.length).toBeGreaterThan(20);
    // لا سر في أي مجرى إخراج ولا في وسائط العملية
    expect(run.stdout).not.toContain(rawKey);
    expect(run.stderr).not.toContain(rawKey);
    expect(run.stdout).not.toContain("Bearer ops-cli-tenant." + rawKey);
    expect(JSON.stringify(run.args)).not.toContain(rawKey);
    // المعرفات تُعرض منفصلة دون السر
    expect(run.stdout).toContain("credentialId=bootstrap-ops-cli-tenant");
    expect(run.stdout).toContain("expiresAt=");
    expect(run.stdout).toContain(secretFile);
  });

  it("يرفض الكتابة فوق ملف سر موجود — إنشاء ذري بلا overwrite", () => {
    const secretFile = join(workDir, "secret-2.env");
    const first = runOps(onboardArgs(secretFile));
    expect(first.status).toBe(0);
    const contentBefore = readFileSync(secretFile, "utf8");
    const second = runOps(onboardArgs(secretFile));
    expect(second.status).toBe(2);
    expect(second.stderr).toContain("موجود مسبقاً");
    // الملف لم يُمس — المفتاح الأول باقٍ حصراً
    expect(readFileSync(secretFile, "utf8")).toBe(contentBefore);
  });

  it("negative control: قناة الأنابيب بلا --secret-output ترفض fail-closed ولا يُطبع سر", () => {
    // spawnSync أنبوب حصراً (لا TTY) — الرفض هو السلوك الآمن المطلوب
    const run = runOps([
      "onboard-tenant", "--tenant", "ops-cli-pipe", "--name", "أنبوب", "--issuer", "https://idp.ops.test",
      "--subject", "ops-owner-2", "--permissions", "resource:read", "--expires-in-days", "30", "--store", "memory",
    ]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("stdout غير تفاعلي");
    // لا Bearer يحمل مفتاحاً في أي مجرى
    expect(run.stdout).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/u);
    expect(run.stderr).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/u);
  });
});

describe("صرامة تحليل وسائط CLI", () => {
  it("يرفض علماً غير معروف وأخطاء إملائية مثل --stroe", () => {
    const typo = runOps(["tenant-delete", "--tenant", "t", "--stroe", "live", "--mode", "dry-run"]);
    expect(typo.status).toBe(2);
    expect(typo.stderr).toContain("علم غير معروف");
    const unknown = runOps(["legal-hold", "--tenant", "t", "--until", "2099-01-01T00:00:00.000Z", "--store", "memory", "--force", "1"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("علم غير معروف");
  });

  it("يرفض --store بقيمة خارج memory|live وغياب --store كلياً", () => {
    const badStore = runOps(["legal-hold", "--tenant", "t", "--until", "2099-01-01T00:00:00.000Z", "--store", "fast"]);
    expect(badStore.status).toBe(2);
    expect(badStore.stderr).toContain("memory أو live");
    const noStore = runOps(["credential-revoke", "--tenant", "t", "--credential", "c"]);
    expect(noStore.status).toBe(2);
    expect(noStore.stderr).toContain("--store");
  });

  it("يرفض تكرار علم أحادي ووسيطة موضعية وقيمة منطقية غير 1", () => {
    const duplicate = runOps(["legal-hold", "--tenant", "a", "--tenant", "b", "--until", "2099-01-01T00:00:00.000Z", "--store", "memory"]);
    expect(duplicate.status).toBe(2);
    expect(duplicate.stderr).toContain("مكررة");
    const positional = runOps(["legal-hold", "positional", "--tenant", "a", "--until", "2099-01-01T00:00:00.000Z", "--store", "memory"]);
    expect(positional.status).toBe(2);
    expect(positional.stderr).toContain("موضعية");
    const boolValue = runOps(["onboard-tenant", "--tenant", "t-bool", "--name", "ن", "--issuer", "https://i.test",
      "--subject", "s", "--permissions", "resource:read", "--expires-in-days", "30", "--store", "memory",
      "--initial", "true"]);
    expect(boolValue.status).toBe(2);
    expect(boolValue.stderr).toContain('قيمته المقبولة "1"');
  });

  it("يرفض --admin-database-url كعلم غير معروف — الاتصال عبر البيئة حصراً", () => {
    const dsnFlag = runOps(["retention-sweep", "--tenant", "t", "--store", "live", "--admin-database-url", "postgresql://x:y@host/db"]);
    expect(dsnFlag.status).toBe(2);
    expect(dsnFlag.stderr).toContain("علم غير معروف");
    expect(dsnFlag.stderr).not.toContain("postgresql://");
  });
});
