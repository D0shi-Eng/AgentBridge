/** احتواء Docker بفحوص ساكنة وإقلاع سلبي حقيقي؛ لا نبني صورة أو ننفذ runner مزيفاً. */
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
describe("احتواء محدود", () => {
  it("التثبيت frozen ولا إخفاء فشل، ومتطلبات workspace تصل للصورة", () => {
    const file = readFileSync(join(ROOT, "docker/sandbox.Dockerfile"), "utf8");
    expect(file).not.toMatch(/\|\|\s*true/u);
    expect(file).toContain("pnpm-lock.yaml tsconfig.base.json");
    expect(file).toContain("pnpm@11.22.0");
    expect(file).toContain("install --frozen-lockfile --ignore-scripts");
    expect(file).toContain("COPY --chown=65532:65532 tests ./tests");
    expect(file).toContain("RUN node docker/sandbox-entrypoint.mjs --check");
  });
  it("القيود محفوظة والسياق يستبعد الأسرار والمخرجات", () => {
    const compose = readFileSync(join(ROOT, "docker-compose.sandbox.yaml"), "utf8");
    for (const text of ["read_only: true", 'user: "65532:65532"', "network_mode: none", "pids_limit: 64", "mem_limit: 512m"]) {
      expect(compose).toContain(text);
    }
    const ignore = readFileSync(join(ROOT, ".dockerignore"), "utf8");
    for (const text of ["**/.env", "**/node_modules", "**/*.log"]) expect(ignore).toContain(text);
    expect(ignore).not.toContain("pnpm-lock.yaml");
  });
  it("غياب artifact يمنع الإقلاع والفحص برمز خروج غير صفري", () => {
    const isolated = mkdtempSync(join(tmpdir(), "ab-p2-missing-"));
    for (const args of [[], ["--check"]]) {
      const result = spawnSync(process.execPath, [join(ROOT, "docker/sandbox-entrypoint.mjs"), ...args],
        { cwd: isolated, encoding: "utf8", timeout: 10000 });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Built sandbox runner is missing");
    }
  });
  it("قفل غير مطابق يفشل في سياق مؤقت دون تغيير القفل الحقيقي", () => {
    const isolated = mkdtempSync(join(tmpdir(), "ab-p2-lock-"));
    writeFileSync(join(isolated, "package.json"), JSON.stringify({ private: true, dependencies: { zod: "3.25.76" } }));
    writeFileSync(join(isolated, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nimporters:\n  .: {}\n");
    const manager = process.env.npm_execpath;
    // يُمرر مسار pnpm الفعلي من runner المراجع؛ لا تثبيت أو تنزيل عند غياب الأداة.
    if (!manager || !/pnpm\.(?:(?:c|m)?js)$/u.test(manager)) throw new Error("pnpm executable path required for isolated lock test");
    const result = spawnSync(process.execPath, [manager, "install", "--frozen-lockfile", "--ignore-scripts", "--offline"],
      { cwd: isolated, encoding: "utf8", timeout: 20000 });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("OUTDATED_LOCKFILE");
  });
});
