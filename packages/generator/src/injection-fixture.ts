/** أدوات اختبار نقية: إنشاء مدخل مصغر وتحليل AST دون تحميل المصدر المولد. */
import ts from "typescript";
import type { GenerationInput } from "./emitter.js";
import { generateServer } from "./emitter.js";

export function injectionInput(path: string, parameter = "id", sequential = false): GenerationInput {
  const endpoint = {
    path, method: "get" as const, operationId: "read", summary: "Read one item",
    pathParams: [parameter], requiresAuth: false,
    security: { alternatives: [], source: "none" as const, unsupported: [] },
    fields: [{ pointer: "/parameters/0", name: parameter, location: "path" as const,
      openApiType: "string", required: true }],
  };
  return {
    analyzed: {
      spec: { title: "Safe", openapiVersion: "3.0.3", endpointCount: 2,
        endpoints: [{ ...endpoint, operationId: "first", path: "/first/{" + parameter + "}" }, endpoint] },
      kinds: {}, risks: {}, piiHits: [], mcpWorthyIds: ["read"],
    },
    designs: [{ name: "read_item", description: "Read item safely",
      endpointIds: sequential ? ["first", "read"] : ["read"],
      parameters: Object.fromEntries([[parameter, { type: "string", required: true, description: "Parameter" }]]) }],
  };
}

export function toolsSource(input: GenerationInput): string {
  const result = generateServer(input);
  if (!result.ok) throw result.error;
  return result.value.files.find((file) => file.path === "src/tools.ts")?.contents ?? "";
}

/** كل نوع عقدة ومعرف محفوظ؛ قيم string literals وحدها متغيرة ومسموح بها كبيانات. */
export function structure(source: string): string[] {
  const file = ts.createSourceFile("tools.ts", source, ts.ScriptTarget.ES2022, true);
  const nodes: string[] = [];
  const visit = (node: ts.Node): void => {
    nodes.push(ts.SyntaxKind[node.kind] + (ts.isIdentifier(node) ? `:${node.text}` : ""));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return nodes;
}

export function diagnostics(source: string): readonly string[] {
  // تحليل نحوي فقط؛ يشمل declaration files بلا محاولة إصدارها أو تحميل imports.
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, noEmit: true, noResolve: true, noLib: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => name === "specimen.ts"
    ? ts.createSourceFile(name, source, ts.ScriptTarget.ES2022, true) : undefined;
  const program = ts.createProgram(["specimen.ts"], options, host);
  return program.getSyntacticDiagnostics().map((item) => ts.flattenDiagnosticMessageText(item.messageText, " "));
}
