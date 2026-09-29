/** قبول عينة سليمة فقط: SDK رسمي وupstream محلي، دون payload عدائي. */
import { cleanTestDirectory } from "./test-directory.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MockLlmProvider } from "@agentbridge/llm";
import { parseOpenApiSpec } from "@agentbridge/spec-parser";
import { analyzeSpec } from "@agentbridge/analyzer";
import { DesignerAgent } from "@agentbridge/agents";
import { generateServer, writeArtifact } from "./index.js";
import type { Server } from "node:http";
import { TARGET_DIR, VALID_BATCH, petstoreYaml, startMockUpstream } from "./generated-test-support.js";
describe("القبول النهائي — الخادم المولد يعمل ويرد عبر SDK", () => {
  let upstream: { server: Server; baseUrl: string };
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    // 1) استيعاب وتحليل المواصفة المرجعية
    const parsed = parseOpenApiSpec(petstoreYaml);
    if (!parsed.ok) throw new Error("petstore يجب أن تُستوعب");
    const analyzed = analyzeSpec(parsed.value);

    // 2) التصميم عبر الوكيل الحقيقي بمزود وهمي حتمي
    const designer = new DesignerAgent(
      new MockLlmProvider({ responses: [JSON.stringify(VALID_BATCH)] }),
    );
    const designResult = await designer.designTools({ analyzed, tenantId: "e2e" });
    if (!designResult.ok) throw new Error(`فشل التصميم: ${designResult.error.message}`);

    // 3) التوليد والكتابة على القرص
    const generated = generateServer({
      analyzed,
      designs: designResult.value.designs,
      options: { serverName: "mini-petstore" },
    });
    if (!generated.ok) throw new Error(`فشل التوليد: ${generated.error.message}`);
    await cleanTestDirectory(TARGET_DIR);
    const written = await writeArtifact(generated.value, { targetDir: TARGET_DIR });
    if (!written.ok) throw new Error(`فشل الكتابة: ${written.error.message}`);
    // نبني العينة السليمة فعلياً؛ تشغيل SDK اللاحق يستخدم JavaScript الناتج من tsc.
    const tsc = fileURLToPath(new URL("../../../node_modules/typescript/bin/tsc", import.meta.url));
    execFileSync(process.execPath, [tsc, "-p", join(TARGET_DIR, "tsconfig.json")], { timeout: 30000, stdio: "inherit" });

    // 4) upstream محلي + 5) إقلاع الخادم المولد وربط عميل MCP رسمي
    upstream = await startMockUpstream();
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(TARGET_DIR, "dist", "server.js")],
      env: { ...process.env, UPSTREAM_BASE_URL: upstream.baseUrl },
      cwd: TARGET_DIR,
      stderr: "inherit",
    });
    client = new Client({ name: "acceptance-client", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
    upstream?.server.close();
    await cleanTestDirectory(TARGET_DIR);
  });

  it("listTools يعيد الأدوات الأربع بأوصافها", async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    expect(names).toEqual(["create_pet", "delete_pet", "get_pet_by_id", "list_pets"]);

    const getTool = tools.tools.find((tool) => tool.name === "get_pet_by_id");
    expect(getTool?.description).toContain("Retrieve one pet");
    expect(getTool?.inputSchema).toHaveProperty("properties.petId");
  });

  it("callTool حقيقي: قراءة حيوان بمعرف مسار مشفر", async () => {
    const result = await client.callTool({ name: "get_pet_by_id", arguments: { petId: "42" } });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(JSON.parse(text)).toEqual({ id: "42", name: "RexTheFortyTwo" });
  });

  it("callTool حقيقي: قائمة مع معامل استعلام اختياري", async () => {
    const result = await client.callTool({ name: "list_pets", arguments: { limit: 2 } });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(JSON.parse(text)).toHaveLength(2);
  });

  it("SDK يرفض نوع المدخل المخالف قبل upstream", async () => {
    const result = await client.callTool({ name: "get_pet_by_id", arguments: { petId: 42 } });
    expect(result.isError).toBe(true);
  });

  it("callTool حقيقي: إنشاء بجسم JSON من معاملات body", async () => {
    const result = await client.callTool({
      name: "create_pet",
      arguments: { name: "Bobby", tag: "friendly" },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(JSON.parse(text)).toEqual({ id: "99", created: true });
  });

  it("فشل upstream يعيد isError برسالة منظفة لا تسرّب المحتوى", async () => {
    const result = await client.callTool({
      name: "get_pet_by_id",
      arguments: { petId: "boom" },
    });
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain("500"); // الحالة مذكورة
    expect(text).not.toContain("DO-NOT-LEAK"); // والمحتوى ممنوع
  });
});
