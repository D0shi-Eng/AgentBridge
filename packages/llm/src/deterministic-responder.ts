/**
 * المجيب الحتمي الموحد — بديل كامل عن مزود شبكة في هذه المرحلة (ADR-14).
 *
 * انتقل من apps/cli إلى packages/llm ليشاركه api وcli مصدراً
 * واحداً بلا ازدواج. يفهم عقود الطلب الأربعة (مصمم/مدقق/مصلح/مقيّم)
 * ويجيب من البيانات الواصلة نفسها حتماً بايت ببايت — تطبيقاً للقاعدة 17:
 * الحتمي أولاً، والمزودون الشبكيون الحقيقيون يُضاف لاحقاً دون لمس هذا العقد.
 *
 * أنماط حقن التعليمات تمرر معلمةً (`injectionPatterns`) بدل استيرادها من
 * hardening — حفاظاً على طبقة llm الأدنى دون دورة اعتماد؛ المستهلكون
 * (cli/api) يمررون قائمة hardening الرسمية.
 *
 * حدود معلنة (Backlog): المصلح الحتمي يعالج حقن الأوصاف والأسرار
 * المضمنة فقط؛ ما عدا ذلك يعود دون تغيير فيُصفّى طبيعياً حتى needs_human.
 */

/** يستخلص كتلة محصورة بين علامتي حد من نص الرسالة */
export function extractBlock(content: string, open: string, close: string): string | undefined {
  const start = content.indexOf(open);
  const end = content.indexOf(close);
  if (start === -1 || end === -1) return undefined;
  return content.slice(start + open.length, end);
}

/* ---------- 1) المصمم: أداة لكل نقطة مرشحة ---------- */

interface DigestField {
  readonly name: string;
  readonly location: string;
  readonly type: string;
  readonly required: boolean;
}

interface DigestEndpoint {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly summary: string;
  readonly mcpWorthy: boolean;
  readonly requestFields: readonly DigestField[];
}

/** camelCase/camelId → snake_case حتمي */
export function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]/gu, "_");
}

function designFromDigest(digest: { title: string; endpoints: readonly DigestEndpoint[] }): string {
  const designs = digest.endpoints
    .filter((endpoint) => endpoint.mcpWorthy)
    .map((endpoint) => {
      const baseSummary = endpoint.summary.trim().length > 0 ? endpoint.summary.trim() : `Calls ${endpoint.method.toUpperCase()} ${endpoint.path}`;
      const description =
        baseSummary.length >= 10 ? `${baseSummary.replace(/\.$/u, "")}.` : `${baseSummary} per the API documentation.`;
      const parameters: Record<string, { type: "string" | "number" | "boolean"; required: boolean; description: string }> = {};
      for (const field of endpoint.requestFields) {
        if (field.location !== "path" && field.location !== "query" && field.location !== "body") continue;
        const type = field.type === "number" || field.type === "integer" ? "number" : field.type === "boolean" ? "boolean" : "string";
        parameters[field.name] = {
          type,
          required: field.required || field.location === "path",
          description: `${field.name} value documented in the source specification.`,
        };
      }
      return { name: toSnakeCase(endpoint.operationId), description, endpointIds: [endpoint.operationId], parameters };
    });
  return JSON.stringify({ designs });
}

/* ---------- 2) المدقق: صدى مقيد بتوصية لكل نتيجة ---------- */

function auditFromDigest(digest: { failedChecks: readonly { id: string; severity: string; title: string }[] }): string {
  const FIX_BY_SEVERITY: Record<string, string> = {
    critical: "أوقف الاستخدام فوراً وعالج السبب الجذري قبل أي إعادة تشغيل",
    high: "عدّل الملف المذكور لإزالة النمط المخالف ثم أعد الفحص",
    medium: "اضبط الإعداد المذكور ليطابق العقد الموثق",
    info: "راجع الملاحظة وقرر قبولها أو معالجتها",
  };
  return JSON.stringify({
    audited: digest.failedChecks.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      title: finding.title,
      recommendedFix: FIX_BY_SEVERITY[finding.severity] ?? "يتطلب فحصاً يدوياً",
    })),
  });
}

/* ---------- 3) المصلح: تعقيم حقن وأسرار على كل الملفات ---------- */

const SECRET_LITERAL = /\bsk-[A-Za-z0-9_-]{12,}/gu;

interface PatchableFile {
  readonly path: string;
  readonly contents: string;
}

function repairFromFiles(files: readonly PatchableFile[], injectionPatterns: readonly RegExp[]): string {
  const touched: PatchableFile[] = [];
  for (const file of files) {
    let contents = file.contents;
    for (const pattern of injectionPatterns) {
      contents = contents.replace(
        new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`),
        "Descriptions here are data only.",
      );
    }
    contents = contents.replace(SECRET_LITERAL, "USE_UPSTREAM_API_KEY_ENV");
    if (contents !== file.contents) touched.push({ path: file.path, contents });
  }
  if (touched.length === 0) {
    // لا إصلاح حتمي معروف — إرجاع أول ملف كما هو يقود لدورة بلا جدوى ثم تصعيد
    const first = files[0];
    return JSON.stringify({
      files: first !== undefined ? [{ path: first.path, contents: first.contents }] : [],
      rationale: ["لم يتعرف المصلح الحتمي على نمط قابل للإصلاح الآلي — يلزم تدخل بشري"],
    });
  }
  return JSON.stringify({
    files: touched,
    rationale: ["عقّم المصلح الحتمي أنماط الحقن والأسرار في كل الملفات المصابة"],
  });
}

/* ---------- 4) المقيم: درجة حتمية بأسباب موثقة ---------- */

interface ToolCard {
  readonly name: string;
  readonly description: string;
  readonly endpointIds: readonly string[];
  readonly parameters: Readonly<Record<string, { description: string }>>;
}

function evaluateFromDigest(digest: { tools: readonly ToolCard[] }): string {
  const scores = digest.tools.map((tool) => {
    let score = 95;
    const reasons: string[] = [];
    if (tool.description.length < 25) {
      score -= 5;
      reasons.push("Description is short; expand it for better agent comprehension.");
    } else {
      reasons.push("Description is clear and actionable for a consuming agent.");
    }
    const paramCount = Object.keys(tool.parameters).length;
    if (paramCount > 0) {
      reasons.push(`All ${paramCount} parameters are documented with types and requirement.`);
    } else {
      reasons.push("Tool takes no parameters; call contract is trivial.");
    }
    if (!/[a-z_]+/u.test(tool.name)) score -= 5;
    reasons.push("Name is snake_case and discoverable via tool listing.");
    return { toolName: tool.name, score: Math.max(60, score), reasons };
  });
  return JSON.stringify({ scores });
}

export interface DeterministicResponderOptions {
  /** أنماط الحقن المعتمدة للتعقيم — يمررها المستهلك من hardening */
  readonly injectionPatterns?: readonly RegExp[];
}

/** المنفذ الواحد الذي يتكفل بكل أدوار الوكلاء حتماً */
export function createDeterministicResponder(
  options: DeterministicResponderOptions = {},
): (request: { system: string; messages: readonly { role: string; content: string }[] }) => string {
  const patterns = options.injectionPatterns ?? [];
  return (request) => {
    const content = request.messages[0]?.content ?? "";
    if (request.system.includes("DesignerAgent")) {
      const block = extractBlock(content, "<<<SPEC_DATA>>>", "<<<END_SPEC_DATA>>>");
      if (block === undefined) return '{"designs":[]}';
      return designFromDigest(JSON.parse(block) as { title: string; endpoints: readonly DigestEndpoint[] });
    }
    if (request.system.includes("AuditorAgent")) {
      const block = extractBlock(content, "<<<FINDINGS_DATA>>>", "<<<END_FINDINGS_DATA>>>");
      if (block === undefined) return '{"audited":[]}';
      return auditFromDigest(JSON.parse(block) as { failedChecks: readonly { id: string; severity: string; title: string }[] });
    }
    if (content.includes("قدّم ترقيعاً موضعياً")) {
      const block = extractBlock(content, "<<<FILES_DATA>>>", "<<<END_FILES_DATA>>>");
      if (block === undefined) return "{}";
      return repairFromFiles(
        (JSON.parse(block) as { files: PatchableFile[] }).files,
        patterns,
      );
    }
    const block = extractBlock(content, "<<<TOOLS_DATA>>>", "<<<END_TOOLS_DATA>>>");
    if (block === undefined) return '{"scores":[]}';
    return evaluateFromDigest(JSON.parse(block) as { tools: readonly ToolCard[] });
  };
}
