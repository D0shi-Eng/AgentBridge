/**
 * جسر sandbox الحي.
 *
 * ماهيته: بديل إقلاع الخادم المولد على المضيف — يبني job JSON من الـartifact
 * ويشغّل حاوية runner المعزول بالقيود الكاملة ثم يتحقق بالمخرجات مخططياً.
 * وظيفته:
 *   - لا shell إطلاقاً (spawnSync shell:false) ولا مسارات من المدخل غير
 *     الموثوق: job يُكتب عبر stdin، والصورة/القيود من إعداد الخادم الموثوق.
 *   - القيود كلها **مفروضة فعلاً** بـflags: network none، read-only، غير
 *     root، cap-drop ALL، no-new-privileges، seccomp مخصص، cpus/memory/pids،
 *     timeout صارم، واسم مميز ab-sandbox- لضمان تنظيف ما أنشأناه فقط.
 *   - المخرجات تُتحقق Zod حصراً — لا ثقة بـstdout الحاوية قبل البوابة.
 * كيف: دالة واحدة تعيد نفس شكل runLiveProbes (checks) + كتلة sandbox
 * attestation لسجل التدقيق وربط الدليل بصورة runner وسياساته.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Errors, err, ok, type Result } from "@agentbridge/shared";
import { SecurityCheckResultSchema } from "@agentbridge/hardening";
import type { GeneratedServerArtifact } from "@agentbridge/shared";
import type { SecurityCheckResult } from "@agentbridge/hardening";
import type { DerivedProbeTargets } from "./probe-targets.js";

/** خيارات تشغيل sandbox — قيم افتراضية مطابقة لـSANDBOX_CONSTRAINTS المشددة */
export interface SandboxRunOptions {
  /** مرجع صورة runner الموثوقة (تُبنى من docker/sandbox-runner) */
  readonly imageRef: string;
  /** مسار profile seccomp على المضيف */
  readonly seccompProfilePath: string;
  readonly timeoutMs: number;
  readonly cpus: number;
  readonly memory: string;
  readonly pidsLimit: number;
}

export const DEFAULT_SANDBOX_OPTIONS: SandboxRunOptions = {
  imageRef: "agentbridge/sandbox-runner:isolated",
  seccompProfilePath: fileURLToPath(new URL("../../../../docker/sandbox-runner/seccomp.json", import.meta.url)),
  timeoutMs: 120_000,
  cpus: 1,
  memory: "512m",
  pidsLimit: 64,
};

/** كتلة إثبات sandbox المرفقة بالدليل الحي — الربط الملزم بالبيئة */
export const SandboxAttestationSchema = z.object({
  imageRef: z.string().min(1),
  imageDigest: z.string().min(1),
  seccompProfile: z.literal("sandbox-seccomp-1"),
  constraintsVersion: z.literal("sandbox-constraints-1"),
  cpus: z.number().positive(),
  memoryLimit: z.string().min(1),
  pidsLimit: z.number().int().positive(),
  network: z.literal("none"),
  user: z.literal("65532:65532"),
  timeoutMs: z.number().int().positive(),
  exitCode: z.number().int(),
  startedAt: z.string(),
  finishedAt: z.string(),
  runnerLog: z.array(z.string()).max(100),
}).strict();

/** كتلة إثبات sandbox المرفقة بالدليل الحي — الربط الملزم بالبيئة (نوع) */
export type SandboxAttestation = z.infer<typeof SandboxAttestationSchema>;

export interface SandboxProbeRun {
  readonly checks: readonly SecurityCheckResult[];
  readonly sandbox: SandboxAttestation;
}

/** مخطط مخرجات runner — بوابة الحقيقة على كل ما يخرج من الحاوية */
const RunnerOutputSchema = z.object({
  ok: z.boolean(),
  startedAt: z.string(),
  finishedAt: z.string(),
  checks: z.array(SecurityCheckResultSchema),
  error: z.string().optional(),
  log: z.array(z.string()).max(100),
}).strict();

const IMAGE_DIGEST_RE = /^[a-f0-9]{12,64}$/;

/** بصمة الصورة من المضيف — للربط الملزم بين الدليل وصورة runner الفعلية */
function imageDigest(imageRef: string): string {
  const inspect = spawnSync("docker", ["image", "inspect", "--format", "{{index .RepoDigests 0}}", imageRef], { encoding: "utf8", shell: false, timeout: 15_000 });
  const raw = (inspect.stdout ?? "").trim();
  // RepoDigests قد يكون فارغاً لصورة مبنية محلياً بلا push — عندها نستخدم معرف الصورة
  if (raw.length > 0) {
    const digestPart = raw.split("@")[1];
    if (digestPart !== undefined && IMAGE_DIGEST_RE.test(digestPart.replace("sha256:", ""))) return digestPart;
  }
  const id = spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", imageRef], { encoding: "utf8", shell: false, timeout: 15_000 });
  const idRaw = (id.stdout ?? "").trim().replace("sha256:", "");
  return IMAGE_DIGEST_RE.test(idRaw) ? idRaw : "unverified";
}

/** يبني job الـrunner من الـartifact والأهداف المشتقة — نصوص فقط داخل stdin */
function buildJob(input: { readonly artifact: GeneratedServerArtifact; readonly declaredToolNames: readonly string[]; readonly targets: DerivedProbeTargets; readonly timeoutMs: number }): string {
  return JSON.stringify({
    files: input.artifact.files.map((file) => ({ path: file.path, contents: file.contents })),
    declaredToolNames: input.declaredToolNames,
    leakTarget: input.targets.leakTarget,
    traversalTarget: input.targets.traversalTarget,
    expectEncoded: input.targets.traversalTarget.expectEncoded,
    timeoutMs: input.timeoutMs,
  });
}

/**
 * يشغّل الفحوص الحية داخل sandbox ويعيد الفحوص + إثبات البيئة.
 * يرمي خطأ صريحاً عند فشل التشغيل (يصنّفه harden-node كفشل مرحلة).
 */
export function runSandboxLiveProbes(input: {
  readonly artifact: GeneratedServerArtifact;
  readonly declaredToolNames: readonly string[];
  readonly targets: DerivedProbeTargets;
  readonly options?: Partial<SandboxRunOptions>;
}): Result<SandboxProbeRun> {
  const options: SandboxRunOptions = { ...DEFAULT_SANDBOX_OPTIONS, ...(input.options ?? {}) };
  const startedAt = new Date().toISOString();
  const job = buildJob({ ...input, timeoutMs: Math.floor(options.timeoutMs * 0.75) });

  const containerName = `ab-sandbox-probe-${createHash("sha256").update(startedAt + input.artifact.toolNames.join(",")).digest("hex").slice(0, 12)}`;
  const runArgs = [
    "run", "--rm",
    "--name", containerName,
    "--network", "none",
    "--read-only",
    "--user", "65532:65532",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--security-opt", `seccomp=${options.seccompProfilePath}`,
    "--tmpfs", "/work:rw,size=64m,noexec,nosuid,uid=65532,gid=65532",
    // /tmp محدود أيضاً — tsx يبني كاش الترجمة تحت /tmp/tsx-<uid>
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m,uid=65532,gid=65532",
    "--cpus", String(options.cpus),
    "--memory", options.memory,
    // swap مثبت بالذاكرة نفسها — السقف صلب؛ نوى WSL الجديدة تسمح
    // بمضعاف الذاكرة swap افتراضياً فيفلت تجاوز السقف بلا قتل (موثق 06)
    "--memory-swap", options.memory,
    "--pids-limit", String(options.pidsLimit),
    "-i", options.imageRef,
    "node", "/opt/deps/runner.mjs",
  ];

  let exitCode = -1;
  let stdout = "";
  let stderr = "";
  try {
    const run = spawnSync("docker", runArgs, {
      input: job,
      encoding: "utf8",
      timeout: options.timeoutMs,
      shell: false,
      maxBuffer: 8 * 1024 * 1024,
    });
    exitCode = run.status ?? -1;
    stdout = run.stdout ?? "";
    stderr = run.stderr ?? "";
  } catch (error) {
    return err(Errors.internal(`فشل تشغيل حاوية sandbox: ${error instanceof Error ? error.message : "?"}`));
  } finally {
    // تنظيف مضمون — نوقف ونمسح ما أنشأناه فقط بالاسم المميز ab-sandbox-
    spawnSync("docker", ["rm", "-f", containerName], { encoding: "utf8", shell: false, timeout: 15_000 });
  }

  const finishedAt = new Date().toISOString();
  if (exitCode !== 0) {
    return err(Errors.internal(`sandbox انتهى برمز ${exitCode} (timeout؟): ${stderr.slice(-400) || stdout.slice(-400)}`));
  }
  const jsonLine = stdout.trim().split("\n").filter((line) => line.trim().startsWith("{")).pop();
  if (jsonLine === undefined) {
    return err(Errors.internal("sandbox أخرج لا JSON إطلاقاً — رُفض الدليل"));
  }
  const parsed = RunnerOutputSchema.safeParse(JSON.parse(jsonLine));
  if (!parsed.success) {
    return err(Errors.invalidInput(`مخرجات runner لا تطابق العقد: ${parsed.error.issues[0]?.path.join(".") ?? "?"}`));
  }
  const output = parsed.data;
  if (!output.ok) {
    return err(Errors.internal(`فحوص sandbox فشلت داخل العزل: ${output.error ?? "بلا تفصيل"}`));
  }
  const attestation: SandboxAttestation = {
    imageRef: options.imageRef,
    imageDigest: imageDigest(options.imageRef),
    seccompProfile: "sandbox-seccomp-1",
    constraintsVersion: "sandbox-constraints-1",
    cpus: options.cpus,
    memoryLimit: options.memory,
    pidsLimit: options.pidsLimit,
    network: "none",
    user: "65532:65532",
    timeoutMs: options.timeoutMs,
    exitCode,
    startedAt,
    finishedAt,
    runnerLog: output.log,
  };
  return ok({ checks: output.checks, sandbox: attestation });
}

/** يقرأ profile seccomp ويتحقق أنه حاجب mount — بوابة فشل-مغلقاً قبل التشغيل */
export function assertSeccompProfileBlocksMounts(profilePath: string = DEFAULT_SANDBOX_OPTIONS.seccompProfilePath): Result<void> {
  try {
    const profile = JSON.parse(readFileSync(join(profilePath), "utf8")) as { syscalls?: Array<{ names?: string[]; action?: string }> };
    const blocked = (profile.syscalls ?? []).some((rule) => rule.action === "SCMP_ACT_ERRNO" && (rule.names ?? []).includes("mount"));
    if (!blocked) return err(Errors.securityCritical("SECCOMP_PROFILE_WEAK"));
    return ok(undefined);
  } catch {
    return err(Errors.invalidInput("profile seccomp غير قابل للقراءة — رُفض تشغيل sandbox"));
  }
}
