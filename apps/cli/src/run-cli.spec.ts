/**
 * اختبار دخان CLI — الرحلة كاملة على التركيبة المرجعية:
 * مواصفة → تشغيل → شهادة منححة وشارة verified على القرص.
 */

import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "./run-cli.js";

const petstorePath = fileURLToPath(new URL("../../../tests/fixtures/mini-petstore.yaml", import.meta.url));
const OUT_DIR = fileURLToPath(new URL("../../../tests/e2e/.tmp/cli-smoke", import.meta.url)).replace(/[\\/]$/u, "");

afterAll(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
});

describe("CLI — مواصفة إلى شهادة", () => {
  it("رحلة كاملة تنتهي بشهادة منححة وملفات مكتوبة ورمز خروج 0", async () => {
    // --live: الفحوص الحية إلزام المنح — الرحلة الساكنة وحدها لا تمنح
    const exitCode = await runCli(["--spec", petstorePath, "--out", OUT_DIR, "--live"]);
    expect(exitCode).toBe(0);

    const certificate = JSON.parse(readFileSync(join(OUT_DIR, "certificate.json"), "utf8")) as {
      granted: boolean;
      finalScore: number;
      verificationId: string;
    };
    expect(certificate.granted).toBe(true);
    expect(certificate.finalScore).toBeGreaterThanOrEqual(85);
    expect(certificate.verificationId.startsWith("AB-")).toBe(true);

    const badge = readFileSync(join(OUT_DIR, "badge.svg"), "utf8");
    expect(badge).toContain("verified");

    const events = readFileSync(join(OUT_DIR, "events.ndjson"), "utf8").trim().split("\n");
    expect(events.length).toBeGreaterThan(10);
    expect(events[0]).toContain('"stage":"load_spec"');
  }, 30000);

  it("وسائط ناقصة ترفض برسالة استخدام ورمز خروج 1", async () => {
    const exitCode = await runCli([]);
    expect(exitCode).toBe(1);
  });
});
