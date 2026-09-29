/** قبول عينة سليمة فقط: SDK رسمي وupstream محلي، دون payload عدائي. */
import { cleanTestDirectory } from "./test-directory.js";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseOpenApiSpec } from "@agentbridge/spec-parser";
import { analyzeSpec } from "@agentbridge/analyzer";
import { generateServer, writeArtifact } from "./index.js";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
describe("الأداة الثنائية endpointIds=2 تنفذ نداءين مرتبين", () => {
  let upstream: { server: Server; baseUrl: string; recorded: string[] };
  let client2: Client;
  let transport2: StdioClientTransport;
  const SEQ_DIR = fileURLToPath(new URL("../../../tests/e2e/.tmp/mini-petstore-seq", import.meta.url));

  function startSeqUpstream(): Promise<{ server: Server; baseUrl: string; recorded: string[] }> {
    return new Promise((resolve) => {
      const recorded: string[] = [];
      const server = createServer((req, res) => {
        const url = req.url ?? "";
        recorded.push(`${req.method ?? "GET"} ${url}`);
        res.setHeader("Content-Type", "application/json");
        if (req.method === "POST" && url === "/seq-first") {
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => { res.statusCode = 201; res.end(JSON.stringify({ seqId: "SEQ-77", created: true })); });
          return;
        }
        if (req.method === "GET" && /^\/seq-second\/[^/]+$/.test(url)) {
          const seqId = url.split("/")[2] ?? "unknown";
          res.end(JSON.stringify({ seqId, ok: true }));
          return;
        }
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "unknown" }));
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address !== null ? address.port : 0;
        resolve({ server, baseUrl: `http://127.0.0.1:${port}`, recorded });
      });
    });
  }

  beforeAll(async () => {
    // مواصفة مصغرة ثنائية بمعرفات متطابقة seqId لاختبار previousResponse
    const seqYaml = `
openapi: 3.0.0
info:
  title: Seq Test
  version: 1.0.0
paths:
  /seq-first:
    post:
      operationId: seqFirst
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
      responses:
        '201':
          description: created
          content:
            application/json:
              schema:
                type: object
                properties:
                  seqId:
                    type: string
  /seq-second/{seqId}:
    get:
      operationId: seqSecond
      parameters:
        - name: seqId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
`;
    const parsed = parseOpenApiSpec(seqYaml);
    if (!parsed.ok) throw new Error(`seq spec يجب أن تُستوعب: ${parsed.error.message}`);
    const analyzed = analyzeSpec(parsed.value);
    const sequentialDesign = {
      name: "create_and_fetch",
      description: "Create then fetch via seqId from previous response",
      endpointIds: ["seqFirst", "seqSecond"],
      parameters: { name: { type: "string" as const, required: true, description: "Name" } },
    };
    const generated = generateServer({ analyzed, designs: [sequentialDesign], options: { serverName: "seq-server" } });
    if (!generated.ok) throw new Error(`فشل التوليد الثنائي: ${generated.error.message}`);
    await cleanTestDirectory(SEQ_DIR);
    const written = await writeArtifact(generated.value, { targetDir: SEQ_DIR });
    if (!written.ok) throw new Error(`فشل الكتابة الثنائية: ${written.error.message}`);
    upstream = await startSeqUpstream();
    transport2 = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", join(SEQ_DIR, "src", "server.ts")],
      env: { ...process.env, UPSTREAM_BASE_URL: upstream.baseUrl },
      cwd: SEQ_DIR,
      stderr: "inherit",
    });
    client2 = new Client({ name: "seq-client", version: "1.0.0" });
    await client2.connect(transport2);
  });

  afterAll(async () => {
    await client2?.close();
    upstream?.server.close();
    await cleanTestDirectory(SEQ_DIR);
  });

  it("نداء واحد ينفذ نداءين upstream مرتبين ويعيد نتيجة الأخيرة", async () => {
    const result = await client2.callTool({ name: "create_and_fetch", arguments: { name: "SeqPet" } });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    const body = JSON.parse(text);
    expect(body).toEqual({ seqId: "SEQ-77", ok: true });
    expect(upstream.recorded.length).toBe(2);
    expect(upstream.recorded[0]).toContain("POST /seq-first");
    expect(upstream.recorded[1]).toContain("GET /seq-second/SEQ-77");
  });
});
