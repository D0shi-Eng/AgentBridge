/** جسم الأداة: بنية ثابتة، وكل اسم ومسار غير موثوق يدخل سياقه المحدد فقط. */
import type { ToolDesign } from "@agentbridge/shared";
import { groupParametersByLocation } from "../tool-codegen.js";
import { parameterAccess, pathExpression, stringLiteral } from "../source-expressions.js";
import type { ToolsTemplateInput } from "./tools-template.js";

export function renderExecutor(design: ToolDesign, input: ToolsTemplateInput): string {
  const entries = Object.entries(design.parameters);
  const properties = entries.map(([name, spec]) =>
    `${stringLiteral(name)}${spec.required ? "" : "?"}: ${spec.type}`).join("; ");
  const signature = entries.length === 0 ? "" : `, args: { ${properties} }`;
  const lines = [`export async function execute_${design.name}(config: ServerConfig${signature}): Promise<ToolResult> {`];
  if (entries.length === 0) lines.push("  const args = {};");
  lines.push("  if (JSON.stringify(args).length > 524288) {");
  lines.push('    return { isError: true, content: [{ type: "text", text: "حمولة كبيرة جداً — 413 Payload Too Large" }] };');
  lines.push("  }");
  lines.push("  let previousResponse: unknown = null;");
  for (const [index, id] of design.endpointIds.entries()) {
    const endpoint = input.endpoints.get(id);
    if (endpoint === undefined) throw new Error("نقطة غير معروفة — Unknown endpoint");
    const grouped = groupParametersByLocation(design, input.requestFields.get(id) ?? []);
    lines.push("  {");
    lines.push(`    const path = ${pathExpression(endpoint.path, index > 0)};`);
    lines.push(...renderParameters(grouped.queryParams, "query", index > 0));
    lines.push(...renderParameters(grouped.bodyParams, "body", index > 0));
    lines.push(...renderParameters(grouped.headerParams, "headers", index > 0));
    const options = [
      `method: ${stringLiteral(endpoint.method.toUpperCase())}`, "path",
      grouped.queryParams.length > 0 ? "query" : "",
      grouped.bodyParams.length > 0 ? "body" : "",
      grouped.headerParams.length > 0 ? "headers" : "",
    ].filter(Boolean).join(", ");
    lines.push(`    const result = await callUpstream(config, { ${options} });`);
    lines.push("    if (!result.ok) {");
    lines.push('      return { isError: true, content: [{ type: "text", text: describeUpstreamFailure(result) }] };');
    lines.push("    }");
    lines.push("    previousResponse = result.body;");
    lines.push("  }");
  }
  lines.push('  return { content: [{ type: "text", text: JSON.stringify(previousResponse ?? null) }] };');
  lines.push("}");
  return lines.join("\n") + "\n";
}

/** كائن بلا prototype للكتابة، وقراءة own فقط؛ لا تغيير صامت لاسم API. */
function renderParameters(names: readonly string[], kind: "query" | "body" | "headers", fallback: boolean): string[] {
  if (names.length === 0) return [];
  const type = kind === "headers" ? "string" : "unknown";
  const declaration = kind === "query" ? "const query = new URLSearchParams();"
    : `const ${kind}: Record<string, ${type}> = Object.create(null);`;
  const lines = [`    ${declaration}`];
  for (const name of names) {
    const value = parameterAccess(name, fallback);
    const key = stringLiteral(name);
    const assignment = kind === "query" ? `query.set(${key}, String(value));`
      : `${kind}[${key}] = ${kind === "headers" ? "String(value)" : "value"};`;
    lines.push(`    { const value = ${value}; if (value !== undefined) ${assignment} }`);
  }
  return lines;
}
