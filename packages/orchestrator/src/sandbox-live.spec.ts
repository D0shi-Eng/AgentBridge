/**
 * رحلة الشهادة داخل العزل.
 *
 * الرحلة الملزمة: OpenAPI موثوقة → توليد → فحوص → **sandbox** → probes →
 * تقييم → شهادة موقعة → (تحقق عام في العرض الحي). الخادم المولد يقلع داخل
 * حاوية sandbox المقيدة حصراً — لا تشغيل على المضيف.
 * مشروط بتوافر Docker وصورة sandbox-runner (غيابهما = تخطٍّ موثق باسمه لا إخفاء).
 */

import { createServer, type Server } from "node:http";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockLlmProvider, type LlmRequest } from "@agentbridge/llm";
import { PipelineOrchestrator } from "./index.js";

const petstoreYaml = readFileSync(
  fileURLToPath(new URL("../../../tests/fixtures/mini-petstore.yaml", import.meta.url)),
  "utf8",
);

const TMP_ROOT = join(tmpdir(), "ab-sandbox-live");

const VALID_BATCH = {
  designs: [
    {
      name: "list_pets",
      description: "List all pets in the store with an optional limit.",
      endpointIds: ["listPets"],
      parameters: { limit: { type: "number", required: false, description: "Max pets to return." } },
    },
    {
      name: "get_pet_by_id",
      description: "Retrieve one pet by its unique identifier.",
      endpointIds: ["showPetById"],
      parameters: { petId: { type: "string", required: true, description: "Pet identifier." } },
    },
  ],
} as const;

function dispatcher(options: { designBatch: unknown; scores?: string }) {
  return (request: LlmRequest): string => {
    if (request.system.includes("DesignerAgent")) return JSON.stringify(options.designBatch);
    return options.scores ?? "{}";
  };
}

function scoresResponse(batch: ReadonlyArray<{ name: string }>): string {
  return JSON.stringify({
    scores: batch.map((design) => ({
      toolName: design.name,
      score: 95,
      reasons: ["وصف واضح ومباشر", "المعاملات موثقة بالكامل"],
    })),
  });
}

/** upstream محلي مبسط على المضيف — **لا يراه sandbox**: الrunner يبدأ مسجله الداخلي */
function startMockUpstream(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      const url = req.url ?? "";
      res.setHeader("Content-Type", "application/json");
      if ((url.startsWith("/pets?") || url === "/pets") && req.method === "GET") {
        res.end(JSON.stringify([{ id: "1", name: "Rex" }]));
      } else if (/^\/pets\/[^/?#]+$/.test(url)) {
        res.end(JSON.stringify({ id: "42", name: "RexTheFortyTwo" }));
      } else {
        res.statusCode = 500;
        req.resume();
        req.on("end", () => res.end(JSON.stringify({ error: "internal_failure" })));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function dockerAvailable(): boolean {
  const probe = spawnSync("docker", ["info", "--format", "ok"], { encoding: "utf8", timeout: 15_000, shell: false });
  return (probe.stdout ?? "").includes("ok");
}

function runnerImageReady(): boolean {
  const probe = spawnSync("docker", ["image", "inspect", "agentbridge/sandbox-runner:isolated"], { encoding: "utf8", timeout: 15_000, shell: false });
  return probe.status === 0;
}

/** التقييم مرة واحدة على مستوى الوصف — غياب البيئة
 * يعني تخطياً مُسمّى في العدادات لا «نجاحاً» صامتاً بلا عمل */
const environmentReady = dockerAvailable() && runnerImageReady();

describe.skipIf(!environmentReady).sequential("رحلة الشهادة داخل sandbox", () => {
  it("خادم سليم: probes داخل العزل → دليل خادمي → شهادة منححة بإثبات بيئة", async () => {
    const upstream = await startMockUpstream();
    try {
      const provider = new MockLlmProvider({
        respond: dispatcher({ designBatch: VALID_BATCH, scores: scoresResponse(VALID_BATCH.designs) }),
      });
      const orchestrator = new PipelineOrchestrator({
        runId: "run-sandbox",
        tenantId: "sandbox-live-tests",
        rawSpec: petstoreYaml,
        provider,
        harden: { workDir: join(TMP_ROOT, "live"), liveProbes: true, sandbox: true },
      });
      const summary = await orchestrator.run();
      expect(summary.finalStatus).toBe("completed");
      // المنح داخل العزل بدليل حي خادمي مرتبط بالبصمة
      expect(summary.certificate?.granted).toBe(true);
      expect(summary.certificate?.liveProbeEvidence?.probedArtifactsHash).toBe(summary.certificate?.artifactsHash);
      // إثبات بيئة sandbox مرفق في snapshot التشغيل — الربط الملزم
      const snapshot = JSON.parse(summary.snapshot) as { payload?: { data?: { liveProbeRun?: { sandbox?: { network?: string; user?: string; imageDigest?: string } } } } };
      const sandbox = snapshot.payload?.data?.liveProbeRun?.sandbox;
      expect(sandbox?.network).toBe("none");
      expect(sandbox?.user).toBe("65532:65532");
      expect(sandbox?.imageDigest?.length ?? 0).toBeGreaterThan(10);
    } finally {
      upstream.server.closeAllConnections();
      upstream.server.close();
    }
  }, 180_000);
});
