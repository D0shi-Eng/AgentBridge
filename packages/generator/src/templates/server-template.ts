/**
 * قالب server.ts — نقطة إقلاع الخادم المولد فوق stdio.
 * صغير ومستقر عمداً: كل التوليد الحقيقي يجري في tools.ts.
 */

export interface ServerTemplateInput {
  readonly serverName: string;
  readonly version: string;
}

export function renderServerEntry(input: ServerTemplateInput): string {
  return `/**
 * خادم MCP المولد.
 * الإقلاع: تحميل الإعدادات ← إنشاء الخادم ← تسجيل الأدوات ← الاتصال بـ stdio.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const server = new McpServer({ name: ${JSON.stringify(input.serverName)}, version: ${JSON.stringify(input.version)} });
  registerTools(server, config);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error("فشل إقلاع الخادم المولد:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
`;
}

/** قالب manifest.json — بطاقة الأداة للاستهلاك الآلي لاحقاً */
export interface ManifestInput {
  readonly serverName: string;
  readonly version: string;
  readonly tools: readonly { name: string; description: string; endpointIds: readonly string[] }[];
}

export function renderManifest(input: ManifestInput): string {
  return `${JSON.stringify(
    {
      name: input.serverName,
      version: input.version,
      generatedBy: "AgentBridge",
      protocol: "mcp",
      transport: "stdio",
      env: {
        required: ["UPSTREAM_BASE_URL"],
        optional: ["UPSTREAM_API_KEY"],
      },
      tools: input.tools,
    },
    null,
    2,
  )}\n`;
}
