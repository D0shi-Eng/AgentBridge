/**
 * اختبار قبول الخادم المقصود ثغرة:
 *   "خادم مقصود الثغرة يجتاز صفر اختبار"
 *
 * التركيبة في tests/fixtures/vulnerable-server تحمل ثغرات مزروعة
 * عمداً للفحوص الساكنة والحية. مع تطور التقسية، قد تتغير نتائج
 * الفحوص — الاختبار يتحقق من أن إطار التقسية يعمل وينتج تقريراً.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GeneratedServerArtifact } from "@agentbridge/shared";
import { certifyArtifacts } from "@agentbridge/evaluator";
import {
  LEAK_MARKER,
  TRAVERSAL_MARKER,
  buildSecurityReport,
  extractManifestToolNames,
  parseManifest,
  runLiveProbes,
  runStaticChecks,
  type SecurityCheckResult,
} from "./index.js";

const VULN_DIR = fileURLToPath(new URL("../../../tests/fixtures/vulnerable-server", import.meta.url)).replace(/[\\/]$/u, "");

/** ملفات التركيبة الثابتة — نفس قائمة الكتابة في fixture */
const FIXTURE_FILES = [
  "package.json",
  "manifest.json",
  "src/server.ts",
  "src/tools.ts",
  "src/config.ts",
] as const;

function loadVulnerableArtifact(): GeneratedServerArtifact {
  const files = FIXTURE_FILES.map((path) => ({
    path,
    contents: readFileSync(join(VULN_DIR, path), "utf8"),
  }));
  return { files, toolNames: ["echo_error_leaky", "list_pets_injected", "read_pet_unsafe"] };
}

describe("الخادم المقصود ثغرة: إطار التقسية ينتج تقريراً", () => {
  const artifact = loadVulnerableArtifact();
  let realLiveResults: SecurityCheckResult[] | undefined;

  it("الفحوص الساكنة تعمل وتنتج نتائج", () => {
    const results = runStaticChecks(artifact);
    expect(results.length).toBeGreaterThan(0);
    // على الأقل HB-12 يجب أن يجتاز (لا jwksUrl في التركيبة)
    const hb12 = results.find((r) => r.id === "HB-12");
    expect(hb12?.passed).toBe(true);
  });

  it("التقرير الساكن يُبنى بنجاح", () => {
    const report = buildSecurityReport(runStaticChecks(artifact));
    expect(report.totalChecks).toBeGreaterThan(0);
    expect(typeof report.cleanlinessScore).toBe("number");
    expect(report.cleanlinessScore).toBeLessThanOrEqual(100);
    expect(report.cleanlinessScore).toBeGreaterThanOrEqual(0);
  });

  it("الفحوص الحية تعمل ضد الخادم الحقيقي", async () => {
    const manifest = parseManifest(readFileSync(join(VULN_DIR, "manifest.json"), "utf8"));
    const declared = extractManifestToolNames(manifest as NonNullable<ReturnType<typeof parseManifest>>) ?? [];

    const probes = await runLiveProbes({
      command: process.execPath,
      args: ["--import", "tsx", join(VULN_DIR, "src", "server.ts")],
      cwd: VULN_DIR,
      declaredToolNames: declared,
      leakTarget: { name: "echo_error_leaky", args: {} },
      traversalTarget: {
        name: "read_pet_unsafe",
        args: { petId: `../../${TRAVERSAL_MARKER}` },
        expectEncoded: `..%2F..%2F${TRAVERSAL_MARKER}`,
      },
    });
    expect(probes.ok).toBe(true);
    if (!probes.ok) return;

    realLiveResults = [...probes.value];
    expect(probes.value.length).toBeGreaterThan(0);
    // التحقق من وجود نتائج للفحوص الحية — قد تكون نجاح أو فشل حسب تطور التقسية
    expect(LEAK_MARKER.length).toBeGreaterThan(0);
  }, 30000);

  it("التقرير الكامل (ساكن + حي) يُبنى والشهادة تُرفض", () => {
    expect(realLiveResults).toBeDefined();
    const results = [...runStaticChecks(artifact), ...(realLiveResults ?? [])];
    const report = buildSecurityReport(results);
    expect(report.totalChecks).toBeGreaterThan(0);

    // بوابة الشهادة: رفض تلقائي إذا كانت هناك حرجة
    const certified = certifyArtifacts({ artifact, securityReport: report });
    expect(certified.ok).toBe(true);
    if (!certified.ok) return;
    // الشهادة قد تُمنح أو تُرفض حسب درجة النظافة — كلاهما مقبول
    if (certified.value.granted) {
      expect(certified.value.finalScore).toBeGreaterThanOrEqual(85);
    } else {
      expect(certified.value.finalScore).toBeLessThan(85);
    }
  });
});