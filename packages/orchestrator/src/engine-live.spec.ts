/**
 * اختبار التشغيل الحي الكامل للمنسق — انفصل عن engine.spec.
 *
 * مسؤوليته الوحيدة: رحلة أنبوب كاملة بفحوص حية مفعلة (liveProbes:true)
 * تنتهي بشهادة منححة بدليل فئات حية مرتبط ببصمة الـartifact. الفحوص
 * الحية تقلع الخادم المولد فعلياً وتهاجمه عبر عميل MCP رسمي — أبطأ
 * من السيناريوهات الساكنة ولذلك ملفه الخاص بمهلة أعلى.
 */

import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockLlmProvider, type LlmRequest } from "@agentbridge/llm";
import { PipelineOrchestrator } from "./index.js";

const petstoreYaml = readFileSync(
  fileURLToPath(new URL("../../../tests/fixtures/mini-petstore.yaml", import.meta.url)),
  "utf8",
);

const TMP_ROOT = fileURLToPath(new URL("../../../tests/e2e/.tmp/orchestrator-live", import.meta.url)).replace(
  /[\\/]$/u,
  "",
);

/** الدفعة الصحيحة المعتمدة — نفس دفعة التصميم في engine.spec */
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

/** يوجّه استجابات المزود الوهمي بحسب وكيل الطلب (نسخة عن engine.spec) */
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

/** upstream محلي مبسط يطابق مسارات petstore — نسخة مستقلة عن mocks الاختبار */
function startMockUpstream(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      const url = req.url ?? "";
      res.setHeader("Content-Type", "application/json");
      if ((url.startsWith("/pets?") || url === "/pets") && req.method === "GET") {
        res.end(JSON.stringify([{ id: "1", name: "Rex" }, { id: "2", name: "Masha" }]));
      } else if (/^\/pets\/[^/?#]+$/.test(url)) {
        res.end(JSON.stringify({ id: "42", name: "RexTheFortyTwo" }));
      } else {
        res.statusCode = 500;
        req.resume();
        req.on("end", () => res.end(JSON.stringify({ error: "internal_failure", secret: "LIVE-TEST-SECRET" })));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

describe("PipelineOrchestrator — التشغيل الحي الكامل", () => {
  it("خادم مقلع فعلياً يجتاز 19 فحصاً وتصدر شهادة منححة بدليل فئات حية", async () => {
    const upstream = await startMockUpstream();
    try {
      const provider = new MockLlmProvider({
        respond: dispatcher({ designBatch: VALID_BATCH, scores: scoresResponse(VALID_BATCH.designs) }),
      });
      const orchestrator = new PipelineOrchestrator({
        runId: "run-live",
        tenantId: "engine-live-tests",
        rawSpec: petstoreYaml,
        provider,
        harden: { workDir: join(TMP_ROOT, "live"), liveProbes: true },
      });
      const summary = await orchestrator.run();
      expect(summary.finalStatus).toBe("completed");
      // المنح معلول بدليل حي مرتبط بالبصمة — لا نجاح بلا فئات حية
      expect(summary.certificate?.granted).toBe(true);
      expect(summary.certificate?.liveProbeEvidence?.probedArtifactsHash).toBe(summary.certificate?.artifactsHash);
      expect(summary.certificate?.finalScore).toBe(98);
      const hardenEvent = summary.events.find((event) => event.stage === "harden" && event.stageStatus === "completed");
      expect(hardenEvent?.summary).toContain("19/19");
    } finally {
      upstream.server.closeAllConnections();
      upstream.server.close();
    }
  }, 45000);
});
