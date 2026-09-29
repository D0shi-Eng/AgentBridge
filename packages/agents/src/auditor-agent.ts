/**
 * وكيل مدقق الأمان AuditorAgent — العقد الثالث في وثيقة 04.
 *
 * المدخل: GeneratedServerArtifact + SecurityReport الخام.
 * المخرج: AuditedFinding[] مرتبة بحسب الخطورة مع توصية إصلاح لكل نتيجة.
 *
 * البوابات: مخطط Zod صارم على كل خرج (بوابة 2) ثم فحص تغطية حتمي:
 * كل نتيجة واصلة تعود مرة واحدة بالضبط — أي نقص أو زيادة يُرفض
 * وتُغذى راجعة بالنموذج ضمن سقف ثلاث دورات ثم فشل منظم (وثيقة 09).
 *
 * الحارس: المدقق لا يعدل الكود إطلاقاً — أدواته قراءة فقط.
 */

import {
  AuditedFindingSchema,
  err,
  ok,
  type AuditedFinding,
  type GeneratedServerArtifact,
  type Result,
  type SecurityFinding,
  type SecurityReport,
} from "@agentbridge/shared";
import type { LlmMessage, LlmProvider } from "@agentbridge/llm";
import { parseStructuredOutput } from "@agentbridge/llm";
import { z } from "zod";
import { AgentsErrors } from "./errors.js";
import { AUDITOR_SYSTEM_PROMPT, buildAuditorUserMessage } from "./prompts/auditor-prompt.js";

/** سقف دورات التدقيق — محاذاة سقف الوكلاء الثلاثة في وثيقة 09 */
export const MAX_AUDIT_ROUNDS = 3;

const AuditorOutputSchema = z
  .object({ audited: z.array(AuditedFindingSchema).max(100) })
  .strict();
export type AuditorOutput = z.infer<typeof AuditorOutputSchema>;

/** ترتيب الخطورة التنازلي — قرار مثبت قابل للاختبار */
const SEVERITY_ORDER: Readonly<Record<AuditedFinding["severity"], number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  info: 3,
};

export interface AuditPhaseInput {
  readonly artifact: GeneratedServerArtifact;
  readonly securityReport: SecurityReport;
  readonly tenantId: string;
}

export interface AuditPhaseResult {
  /** النتائج مرتبة: الحرجة أولاً ثم high ثم medium ثم info */
  readonly auditedFindings: readonly AuditedFinding[];
  readonly roundsUsed: number;
}

export class AuditorAgent {
  constructor(private readonly provider: LlmProvider) {}

  async audit(input: AuditPhaseInput): Promise<Result<AuditPhaseResult>> {
    const summary = this.buildArtifactSummary(input.artifact, input.securityReport);

    const messages: LlmMessage[] = [
      {
        role: "user",
        content: buildAuditorUserMessage(input.securityReport, summary),
      },
    ];

    for (let round = 1; round <= MAX_AUDIT_ROUNDS; round++) {
      const completion = await this.provider.complete({
        system: AUDITOR_SYSTEM_PROMPT,
        messages,
        temperature: 0,
      });
      if (!completion.ok) return err(completion.error);

      const parsed = parseStructuredOutput(
        completion.value.text,
        AuditorOutputSchema,
        "AuditorAgent",
      );
      if (!parsed.ok) {
        this.pushFeedback(messages, completion.value.text, parsed.error.message);
        continue;
      }

      // البوابة المرجعية: تغطية كاملة بلا تكرار ولا اختراع ولا تلاعب بالحقول
      const coverage = checkCoverage(parsed.value.audited, input.securityReport.findings);
      if (coverage.ok) {
        return ok({ auditedFindings: sortBySeverity(coverage.value), roundsUsed: round });
      }
      this.pushFeedback(messages, completion.value.text, coverage.error.message);
    }
    return err(AgentsErrors.auditRoundsExhausted(MAX_AUDIT_ROUNDS));
  }

  /**
   * ملخص حتمي مضغوط للسياق: مسار الملفات + إصابات أنماط الكود الخطِر
   * في كل ملف — مسح نقي بلا نموذج ولا شبكة، نفس المدخل = نفس النص.
   */
  private buildArtifactSummary(artifact: GeneratedServerArtifact, report: SecurityReport): string {
    const dangerousPattern = /eval\(|execSync|readFileSync|node:http|sk-/u;
    const suspiciousHits = artifact.files.flatMap((file) =>
      file.contents
        .split("\n")
        .map((text, index) => ({ text, line: index + 1 }))
        .filter((row) => dangerousPattern.test(row.text))
        .map((row) => `${file.path}:${row.line}`),
    );
    const locations = report.findings
      .map((finding) => finding.location)
      .filter((location): location is string => location !== undefined);
    return JSON.stringify({
      files: artifact.files.map((file) => file.path),
      suspiciousHits,
      reportedLocations: locations,
    });
  }

  private pushFeedback(messages: LlmMessage[], assistantRaw: string, reason: string): void {
    messages.push({ role: "assistant", content: assistantRaw });
    messages.push({
      role: "user",
      content: `رُفض تقريرك في بوابة التحقق. السبب: ${reason}. أعِد الإخراج JSON مطابقاً للعقد.`,
    });
  }
}

/**
 * فحص التغطية الحتمي: كل نتيجة واصلة مغطاة مرة واحدة بالضبط،
 * والمعرفات كلها من قائمة الواصلين (لا اختراع)، والحقول الثابتة
 * (severity/title/location) مطابقة للأصل — التوصية وحدها من إنتاج النموذج.
 */
export function checkCoverage(
  audited: readonly AuditedFinding[],
  original: readonly SecurityFinding[],
): Result<readonly AuditedFinding[]> {
  const byId = new Map(original.map((finding) => [finding.id, finding]));
  const seen = new Set<string>();
  for (const item of audited) {
    const source = byId.get(item.id);
    if (source === undefined) {
      return err(AgentsErrors.auditCoverage(`معرف غير موجود في التقرير: ${item.id}`));
    }
    if (seen.has(item.id)) {
      return err(AgentsErrors.auditCoverage(`معرف مكرر: ${item.id}`));
    }
    seen.add(item.id);
    if (item.severity !== source.severity || item.title !== source.title) {
      return err(AgentsErrors.auditCoverage(`حقول ثابتة معدلة في: ${item.id}`));
    }
  }
  const missing = original.filter((finding) => !seen.has(finding.id)).map((finding) => finding.id);
  if (missing.length > 0) {
    return err(AgentsErrors.auditCoverage(`نتائج بلا تغطية: ${missing.join("، ")}`));
  }
  return ok(audited);
}

function sortBySeverity(findings: readonly AuditedFinding[]): readonly AuditedFinding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
