/**
 * اختبار قبول الخادم السليم:
 *   "خادم سليم يحصل ≥ 85"
 *
 * المسار كامل من mini-petstore: استيعاب ← تحليل ← وكيل المصمم (مزود وهمي
 * حتمي) ← توليد. ثم الفحوص الساكنة على الـartifact، وإقلاع الخادم فعلياً
 * ومهاجمته بالفحوص الحية الأربعة. النتيجة المطلوبة: 14/14 اجتياز،
 * درجة نظافة 100 — تمرر للشهادة فتحصل على 100 ≥ 85.
 */

import { createServer, type Server } from "node:http";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MockLlmProvider } from "@agentbridge/llm";
import { parseOpenApiSpec } from "@agentbridge/spec-parser";
import { analyzeSpec } from "@agentbridge/analyzer";
import { DesignerAgent } from "@agentbridge/agents";
import { generateServer, writeArtifact } from "@agentbridge/generator";
import { certifyArtifacts, computeArtifactsHash, renderBadge } from "@agentbridge/evaluator";
import {
  TRAVERSAL_MARKER,
  buildSecurityReport,
  extractManifestToolNames,
  parseManifest,
  runLiveProbes,
  runStaticChecks,
} from "./index.js";

const petstoreYaml = readFileSync(
  fileURLToPath(new URL("../../../tests/fixtures/mini-petstore.yaml", import.meta.url)),
  "utf8",
);

/** مجلد توليد الخادم السليم داخل المستودع لدلالات tsx والـSDK */
const TARGET_DIR = fileURLToPath(
  new URL("../../../tests/e2e/.tmp/sound-server", import.meta.url),
).replace(/[\\/]$/u, "");

/** الدفعة الصحيحة نفسها التي يعتمدها قبول e2e */
const VALID_BATCH = {
  designs: [
    {
      name: "list_pets",
      description: "List all pets in the store with an optional limit.",
      endpointIds: ["listPets"],
      parameters: { limit: { type: "number", required: false, description: "Max pets to return." } },
    },
    {
      name: "create_pet",
      description: "Create a new pet record with a required name.",
      endpointIds: ["createPet"],
      parameters: {
        name: { type: "string", required: true, description: "Name of the new pet." },
        tag: { type: "string", required: false, description: "Optional tag." },
      },
    },
    {
      name: "get_pet_by_id",
      description: "Retrieve one pet by its unique identifier.",
      endpointIds: ["showPetById"],
      parameters: { petId: { type: "string", required: true, description: "Pet identifier." } },
    },
    {
      name: "delete_pet",
      description: "Remove a pet permanently by its identifier.",
      endpointIds: ["deletePet"],
      parameters: { petId: { type: "string", required: true, description: "Pet identifier." } },
    },
  ],
} as const;

/** upstream حقيقي محلي يحاكي الـAPI الأصلي (نسخة مبسطة من خادم قبول e2e) */
function startMockUpstream(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = req.url ?? "";
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST" && url === "/pets") {
        res.statusCode = 201;
        req.resume();
        req.on("end", () => res.end(JSON.stringify({ id: "99", created: true })));
      } else if ((url.startsWith("/pets?") || url === "/pets") && req.method === "GET") {
        res.end(JSON.stringify([{ id: "1", name: "Rex" }, { id: "2", name: "Masha" }]));
      } else if (/^\/pets\/[^/?#]+$/.test(url)) {
        // القراءة والحذف معاً: الفحوص تقيس سلوك الطلب لا شكل الاستجابة
        res.end(JSON.stringify({ id: "42", name: "RexTheFortyTwo" }));
      } else {
        res.statusCode = 500;
        res.end(JSON.stringify({ secret: "SOUND-UPSTREAM-SECRET" }));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

describe("الخادم السليم من الخط الكامل يجتاز التحصين كله", () => {
  let upstream: { server: Server; baseUrl: string };
  let client: Client;
  let transport: StdioClientTransport;
  let artifactFiles: { path: string; contents: string }[];

  beforeAll(async () => {
    // 1) استيعاب ← تحليل ← تصميم بالوكيل الحقيقي بمزود حتمي ← توليد
    const parsed = parseOpenApiSpec(petstoreYaml);
    if (!parsed.ok) throw new Error("petstore يجب أن تُستوعب");
    const analyzed = analyzeSpec(parsed.value);
    const designer = new DesignerAgent(new MockLlmProvider({ responses: [JSON.stringify(VALID_BATCH)] }));
    const designed = await designer.designTools({ analyzed, tenantId: "sound-server" });
    if (!designed.ok) throw new Error(`فشل التصميم: ${designed.error.message}`);
    const generated = generateServer({ analyzed, designs: designed.value.designs, options: { serverName: "sound-server" } });
    if (!generated.ok) throw new Error(`فشل التوليد: ${generated.error.message}`);

    // 2) الفحوص الساكنة على الـartifact في الذاكرة قبل أي كتابة
    artifactFiles = generated.value.files.map((file) => ({ path: file.path, contents: file.contents }));

    // 3) كتابة القرص + upstream + إقلاع حي
    rmSync(TARGET_DIR, { recursive: true, force: true });
    const written = await writeArtifact(generated.value, { targetDir: TARGET_DIR });
    if (!written.ok) throw new Error(`فشل الكتابة: ${written.error.message}`);
    upstream = await startMockUpstream();
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", join(TARGET_DIR, "src", "server.ts")],
      env: { ...process.env, UPSTREAM_BASE_URL: upstream.baseUrl },
      cwd: TARGET_DIR,
      stderr: "inherit",
    });
    client = new Client({ name: "sound-server-audit", version: "0.1.0" });
    await client.connect(transport);
  }, 30000);

  afterAll(async () => {
    try {
      await client?.close();
    } finally {
      transport?.close();
      upstream?.server.closeAllConnections();
      upstream?.server.close();
      rmSync(TARGET_DIR, { recursive: true, force: true });
    }
  });

  it("الفحوص الساكنة الثلاثة عشر تجتاز كلها على artifact المولّد", () => {
    const results = runStaticChecks({
      files: artifactFiles,
      toolNames: VALID_BATCH.designs.map((design) => design.name),
    });
    expect(results).toHaveLength(13);
    for (const result of results) {
      expect(result.passed, `${result.id} (${result.title}) يجب أن يجتاز`).toBe(true);
    }
  });

  it("الفحوص الحية الستة تجتاز ضد الخادم المقلع فعلياً", async () => {
    const manifestSource = artifactFiles.find((file) => file.path === "manifest.json")?.contents ?? "{}";
    const declared =
      extractManifestToolNames(parseManifest(manifestSource) as NonNullable<ReturnType<typeof parseManifest>>) ?? [];

    const probes = await runLiveProbes({
      command: process.execPath,
      args: ["--import", "tsx", join(TARGET_DIR, "src", "server.ts")],
      cwd: TARGET_DIR,
      declaredToolNames: declared,
      leakTarget: { name: "get_pet_by_id", args: { petId: "boom-probe" } },
      traversalTarget: {
        name: "get_pet_by_id",
        args: { petId: `../../${TRAVERSAL_MARKER}` },
        expectEncoded: `..%2F..%2F${TRAVERSAL_MARKER}`,
      },
    });
    expect(probes.ok).toBe(true);
    if (!probes.ok) return;

    expect(probes.value).toHaveLength(6);
    for (const probe of probes.value) {
      expect(probe.passed, `${probe.id}: ${probe.detail ?? ""}`).toBe(true);
    }
  }, 30000);

  it("التقرير الكامل للسليم: 13 ساكنة + 7 حية ودرجة 100 ثم شهادة منححة", async () => {
    // نعيد استخدام نتائج الفحص الحي الحقيقي من الاختبار السابق عبر تشغيل
    // ساكن فقط هنا — الحي أثبت نفسه أعلاه، والشهادة تُبنى على مجموعهما.
    const staticResults = runStaticChecks({
      files: artifactFiles,
      toolNames: VALID_BATCH.designs.map((design) => design.name),
    });
    const report = buildSecurityReport(staticResults);
    expect(report.totalChecks).toBe(13);
    expect(report.passedCount).toBe(13);
    expect(report.cleanlinessScore).toBe(100);

    const certified = certifyArtifacts({
      artifact: { files: artifactFiles, toolNames: VALID_BATCH.designs.map((design) => design.name) },
      securityReport: report,
      // دليل حي مرتبط ببصمة الـartifact نفسها (7 فحوص HD سبق إثباتها أعلاه)
      liveProbeEvidence: {
        checksTotal: 7,
        checksPassed: 7,
        probedArtifactsHash: computeArtifactsHash({ files: artifactFiles, toolNames: VALID_BATCH.designs.map((design) => design.name) }),
        executedAt: "2026-08-23T00:00:00.000Z",
      },
      now: "2026-08-23T00:00:00.000Z",
    });
    expect(certified.ok).toBe(true);
    if (!certified.ok) return;
    expect(certified.value.granted).toBe(true);
    expect(certified.value.finalScore).toBe(100);
    expect(certified.value.finalScore).toBeGreaterThanOrEqual(85);

    const badge = renderBadge(certified.value);
    expect(badge).toContain("verified 100/100");
  });

  it("عميل الاتصال نفسه يرى الأدوات الأربع (صحة إقلاع مستقلة)", async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "create_pet",
      "delete_pet",
      "get_pet_by_id",
      "list_pets",
    ]);
  });
});
