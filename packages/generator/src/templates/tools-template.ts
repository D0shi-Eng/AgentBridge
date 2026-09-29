/**
 * قالب tools.ts — قلب التوليد: كل ToolDesign تصبح أداة MCP كاملة.
 *
 * لكل أداة يولَّد ثلاثة مقاطع:
 *   1. مخطط zod للمعاملات (يستخدمه registerTool للتحقق الآلي).
 *   2. دالة تنفيذ تبني نداء upstream حسب مواقع المعاملات الحقيقية.
 *   3. سطر تسجيل داخل registerTools الذي يستدعيه server.ts مرة واحدة.
 */

import { renderExecutor } from "./tool-handler.js";
import type { FieldDescriptor, ToolDesign } from "@agentbridge/shared";
import {
  buildZodShapeLiteral,
} from "../tool-codegen.js";

export interface ToolsTemplateInput {
  readonly designs: readonly ToolDesign[];
  /** خريطة operationId ← (method, path) من التحليل */
  readonly endpoints: ReadonlyMap<string, { method: string; path: string }>;
  /** حقول الطلب لكل operationId لتصنيف مواقع المعاملات */
  readonly requestFields: ReadonlyMap<string, readonly FieldDescriptor[]>;
}

/** نص ملف src/tools.ts كاملاً */
export function renderToolsModule(input: ToolsTemplateInput): string {
  const topLevel: string[] = [];
  const registrations: string[] = [];

  for (const design of input.designs) {
    if (design.endpointIds.length === 0) continue;
    const hasParams = Object.keys(design.parameters).length > 0;
    topLevel.push(renderSchemaConst(design));
    topLevel.push(renderExecutor(design, input));
    registrations.push(
      `    server.registerTool(\n` +
        `      ${JSON.stringify(design.name)},\n` +
        `      { description: ${JSON.stringify(design.description)}, inputSchema: schema_${design.name} },\n` +
        `      ${hasParams ? `(args) => execute_${design.name}(config, args)` : `() => execute_${design.name}(config)`},\n` +
        `    );\n`,
    );
  }

  return (
    HEADER +
    topLevel.join("\n") +
    `/** يسجل كل أدوات هذا الخادم على نسخة McpServer */\n` +
    `export function registerTools(server: McpServer, config: ServerConfig): void {\n` +
    registrations.join("\n") +
    "}\n"
  );
}

const HEADER = `/**
 * أدوات هذا الخادم — مولدة آلياً بواسطة AgentBridge، لا تُعدَّل يدوياً.
 * كل أداة تتحقق من معاملاتها بمخطط zod قبل أي نداء شبكي.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult as ToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerConfig } from "./config.js";
import { callUpstream, describeUpstreamFailure } from "./upstream-client.js";

/** لا نقرأ خصائص موروثة من args أو استجابة upstream. */
function own(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
  return (value as Record<string, unknown>)[key];
}

`;

function renderSchemaConst(design: ToolDesign): string {
  return `const schema_${design.name} = ${buildZodShapeLiteral(design)} as const;\n`;
}
