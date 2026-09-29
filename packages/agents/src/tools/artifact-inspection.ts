/**
 * أدوات فحص الـartifact للمدقق — قراءة فقط، بلا أي تعديل (حارس وثيقة 04).
 *
 * read_artifact_source: يقرأ ملفاً واحداً من الـartifact بأسطر مرقمة.
 * grep_artifact: يبحث بنمط regex في كل الملفات ويعيد المواضع مع سطر السياق.
 *
 * الحتمية 100%: لا شبكة ولا نموذج؛ المدخل يتحقق بالمخطط قبل التنفيذ
 * والمخرج بعده — عقد الأداة الموحد في وثيقة 05.
 */

import { Errors, err, ok, type GeneratedServerArtifact, type Result } from "@agentbridge/shared";
import { z } from "zod";
import { validateToolInput, type AgentTool, type ToolContext } from "./tool-contract.js";

/* ---------- read_artifact_source ---------- */

export const ReadSourceInputSchema = z
  .object({ path: z.string().min(1).max(200) })
  .strict();

export interface ReadSourceOutput {
  readonly path: string;
  /** المحتوى بأسطر مرقمة "12: نص السطر" ليعرف المدقق المواضع بدقة */
  readonly numberedLines: readonly string[];
}

const ReadSourceOutputShape = z.object({
  path: z.string(),
  numberedLines: z.array(z.string()),
});

export function createReadArtifactSourceTool(
  artifact: GeneratedServerArtifact,
): AgentTool<z.infer<typeof ReadSourceInputSchema>, ReadSourceOutput> {
  return {
    name: "read_artifact_source",
    description: "قراءة محتوى ملف واحد من الخادم المولد بأسطر مرقمة",
    inputSchema: ReadSourceInputSchema,
    outputSchema: ReadSourceOutputShape,
    async execute(raw, _ctx: ToolContext): Promise<Result<ReadSourceOutput>> {
      const gate = validateToolInput(this.name, ReadSourceInputSchema, raw);
      if (!gate.ok) return gate;

      const file = artifact.files.find((candidate) => candidate.path === gate.value.path);
      if (file === undefined) {
        return err(Errors.invalidInput(`الملف ${gate.value.path} غير موجود في artifact`));
      }
      const numbered = file.contents.split("\n").map((line, index) => `${index + 1}: ${line}`);
      const output: ReadSourceOutput = { path: file.path, numberedLines: numbered };
      if (!ReadSourceOutputShape.safeParse(output).success) {
        return err(Errors.internal("خرج أداة القراءة خالف مخططها — عيب برمجي"));
      }
      return ok(output);
    },
  };
}

/* ---------- grep_artifact ---------- */

export const GrepInputSchema = z
  .object({
    pattern: z.string().min(1).max(200),
    /** أعلام إضافية اختيارية — الحالة الافتراضية حساسة لحالة الأحرف */
    caseInsensitive: z.boolean().optional(),
  })
  .strict();

export interface GrepHit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface GrepOutput {
  readonly hits: readonly GrepHit[];
  readonly total: number;
}

const GrepOutputShape = z.object({
  hits: z.array(z.object({ path: z.string(), line: z.number().int().positive(), text: z.string() })),
  total: z.number().int().nonnegative(),
});

/** سقف النتائج المعادة — حماية من إغراق سياق النموذج بمخرجات ضخمة */
export const GREP_MAX_HITS = 50;

export function createGrepArtifactTool(
  artifact: GeneratedServerArtifact,
): AgentTool<z.infer<typeof GrepInputSchema>, GrepOutput> {
  return {
    name: "grep_artifact",
    description: "بحث بنمط regex في كل ملفات الخادم المولد مع أرقام الأسطر",
    inputSchema: GrepInputSchema,
    outputSchema: GrepOutputShape,
    async execute(raw, _ctx: ToolContext): Promise<Result<GrepOutput>> {
      const gate = validateToolInput(this.name, GrepInputSchema, raw);
      if (!gate.ok) return gate;

      let regex: RegExp;
      try {
        regex = new RegExp(gate.value.pattern, gate.value.caseInsensitive === true ? "iu" : "u");
      } catch {
        return err(Errors.invalidInput(`نمط regex غير صالح: ${gate.value.pattern}`));
      }

      const hits: GrepHit[] = [];
      for (const file of artifact.files) {
        const lines = file.contents.split("\n");
        for (let index = 0; index < lines.length; index++) {
          if (regex.test(lines[index] ?? "")) {
            hits.push({ path: file.path, line: index + 1, text: lines[index] ?? "" });
            if (hits.length >= GREP_MAX_HITS) {
              // الوصول للسقف يعني قطع البحث — التقرير يوضح أن القائمة مقطوعة
              return ok({ hits, total: hits.length });
            }
          }
        }
      }
      const output: GrepOutput = { hits, total: hits.length };
      if (!GrepOutputShape.safeParse(output).success) {
        return err(Errors.internal("خرج أداة grep خالف مخططها — عيب برمجي"));
      }
      return ok(output);
    },
  };
}
