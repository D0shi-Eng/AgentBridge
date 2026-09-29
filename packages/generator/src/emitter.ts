/**
 * المولّد الرئيسي emitter — من التحليل + التصاميم إلى artifact كامل.
 *
 * تسلسل إلزامي: تدقيق دفاعي للمدخلات (لا ثقة بمخرَج الوكيل — القاعدة 16)
 * ← تركيب الملفات من القوالب بترتيب حتمي. نفس المدخل = نفس البايتات.
 */

import type {
  AnalyzedSpec,
  FieldDescriptor,
  GeneratedServerArtifact,
  ToolDesign,
} from "@agentbridge/shared";
import { auditInputs } from "./input-audit.js";
import { err, ok, type Result } from "@agentbridge/shared";
import { GenErrors } from "./errors.js";
import { slugifyName } from "./tool-codegen.js";
import { renderPackageJson } from "./templates/package-template.js";
import { renderTsconfig } from "./templates/tsconfig-template.js";
import { renderConfigModule } from "./templates/config-template.js";
import { renderUpstreamClient } from "./templates/upstream-client-template.js";
import { renderToolsModule } from "./templates/tools-template.js";
import { renderManifest, renderServerEntry } from "./templates/server-template.js";
import { renderReadme } from "./templates/readme-template.js";

/** خيارات التوليد الاختيارية */
export interface GenerationOptions {
  /** اسم الخادم — يفترض اشتقاقه من عنوان المواصفة إن أُغلق */
  readonly serverName?: string;
  readonly version?: string;
}

export interface GenerationInput {
  readonly analyzed: AnalyzedSpec;
  readonly designs: readonly ToolDesign[];
  readonly options?: GenerationOptions;
}

/** المدخل الوحيد للحزمة: ينتج artifact الخادم في الذاكرة */
export function generateServer(input: GenerationInput): Result<GeneratedServerArtifact> {
  const serverName = input.options?.serverName ?? slugifyName(input.analyzed.spec.title);
  const version = input.options?.version ?? "1.0.0";

  const audit = auditInputs(input);
  if (!audit.ok) return audit;

  // خرائط كل نقاط التصميم (تدعم endpointIds>1 بالتسلسل)
  const endpoints = new Map<string, { method: string; path: string }>();
  const requestFields = new Map<string, readonly FieldDescriptor[]>();
  for (const design of input.designs) {
    for (const operationId of design.endpointIds) {
      if (endpoints.has(operationId)) continue;
      const endpoint = input.analyzed.spec.endpoints.find((e) => e.operationId === operationId);
      if (endpoint !== undefined) {
        endpoints.set(operationId, { method: endpoint.method, path: endpoint.path });
        requestFields.set(
          operationId,
          endpoint.fields.filter((field) => !field.pointer.includes("/responses/")),
        );
      }
    }
  }

  const toolNames = input.designs.map((design) => design.name);
  const files = [
    { path: "package.json", contents: renderPackageJson({ packageName: serverName, version }) },
    { path: "tsconfig.json", contents: renderTsconfig() },
    { path: "src/config.ts", contents: renderConfigModule({ serverName }) },
    { path: "src/upstream-client.ts", contents: renderUpstreamClient() },
    { path: "src/tools.ts", contents: renderToolsModule({ designs: input.designs, endpoints, requestFields }) },
    { path: "src/server.ts", contents: renderServerEntry({ serverName, version }) },
    {
      path: "manifest.json",
      contents: renderManifest({ serverName, version, tools: [...input.designs] }),
    },
    { path: "README.md", contents: renderReadme({ serverName, toolNames }) },
  ];

  if (files.reduce((total, file) => total + Buffer.byteLength(file.contents), 0) > 4194304) {
    return err(GenErrors.limitExceeded());
  }
  return ok({ files, toolNames });
}
