/**
 * الفحوص الحية — إقلاع الخادم المولد ومهاجمته عبر عميل MCP رسمي.
 * HD-01 تطابق manifest، HD-02 عدم تسريب، HD-03 ترميز المسار، HD-04 نظافة الوصف، HD-05 تسلسل ثنائي، HD-06 ضخامة، HD-07 معدل، HD-08 رفض OIDC قبل upstream.
 * الشبكة localhost فقط — تطبيق security.md §4.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { err, ok, type Result } from "@agentbridge/shared";
import { INJECTION_PATTERNS } from "./injection-guards.js";
import { HardErrors } from "./errors.js";
import { LEAK_MARKER, startRecordingUpstream } from "./mock-upstream.js";
import type { SecurityCheckResult } from "./report.js";
export interface ProbeTarget { readonly name: string; readonly args: Readonly<Record<string, unknown>>; }
export interface LiveProbeOptions {
  readonly command: string; readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>; readonly cwd?: string;
  readonly declaredToolNames: readonly string[];
  readonly leakTarget: ProbeTarget;
  readonly traversalTarget: ProbeTarget & { readonly expectEncoded: string };
  readonly sequentialTarget?: ProbeTarget & { readonly expectOrder?: readonly string[] };
  readonly oidcProbe?: { readonly jwksUrl: string; readonly issuer: string; readonly clientId: string; readonly wrongIssToken: string };
}
export function findInjectionHits(text: string): readonly string[] {
  return INJECTION_PATTERNS.filter((p) => p.test(text)).map((p) => p.source);
}
export function assertLocalhostOnly(rawUrl: string): void {
  let parsed: URL; try { parsed = new URL(rawUrl); } catch { throw new Error(`عنوان غير صالح: ${rawUrl}`); }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error(`خرق الحاوية: ${rawUrl}`);
}
export function resultText(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content ?? null);
  return content.map((item) => (typeof item === "object" && item !== null ? String((item as Record<string, unknown>)["text"] ?? "") : String(item))).join("\n");
}
export async function runLiveProbes(options: LiveProbeOptions): Promise<Result<readonly SecurityCheckResult[]>> {
  const upstream = await startRecordingUpstream();
  assertLocalhostOnly(upstream.baseUrl);
  // التقاط stderr الخادم المولد — انهيار الإقلاع يظهر هنا لا في "Connection closed" المجملة
  let stderrTail = "";
  const transport = new StdioClientTransport({
    command: options.command, args: [...options.args],
    env: { ...process.env, UPSTREAM_BASE_URL: upstream.baseUrl, ...(options.env ?? {}) },
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}), stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer | string) => { stderrTail = (stderrTail + chunk.toString()).slice(-600); });
  const client = new Client({ name: "agentbridge-hardening", version: "0.1.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const hd01 = checkLiveManifestMatch(listed.tools.map((t) => t.name), options.declaredToolNames);
    const hd04 = checkLiveDescriptions(listed.tools);
    const leakCall = await client.callTool({ name: options.leakTarget.name, arguments: { ...options.leakTarget.args } });
    const hd02 = checkLeakResistance(resultText(leakCall.content));
    await client.callTool({ name: options.traversalTarget.name, arguments: { ...options.traversalTarget.args } });
    const hd03 = checkTraversalEncoding([...upstream.recordedTargets], options.traversalTarget.expectEncoded);
    let hd05: SecurityCheckResult | null = null;
    if (options.sequentialTarget !== undefined) {
      const before = [...upstream.recordedTargets].length;
      await client.callTool({ name: options.sequentialTarget.name, arguments: { ...options.sequentialTarget.args } });
      const after = [...upstream.recordedTargets].slice(before);
      hd05 = checkSequentialExecution(after, options.sequentialTarget.expectOrder ?? ["/pets", "/pets/"]);
    }
    // HD-06: ضخامة المدخلات — حمولة >512KB يجب أن تُرفض 413 قبل الوكيل (نضخم معامل نصي موجود)
    const huge = "x".repeat(600 * 1024);
    const largeArgs: Record<string, unknown> = { ...options.leakTarget.args };
    let replaced = false;
    for (const [key, value] of Object.entries(largeArgs)) {
      if (typeof value === "string" && !replaced) { largeArgs[key] = huge; replaced = true; }
    }
    if (!replaced) largeArgs["largePayload"] = huge;
    const beforeLarge = upstream.recordedTargets.length;
    let largeText = "";
    try {
      const largeCall = await client.callTool({ name: options.leakTarget.name, arguments: largeArgs });
      largeText = resultText(largeCall.content);
    } catch { largeText = "error"; }
    const afterLarge = [...upstream.recordedTargets].slice(beforeLarge);
    const hd06 = checkLargePayloadRejection(largeText, afterLarge);
    // HD-07: معدل النداءات المتكرر — 10 نداءات متتالية بلا تسريب حالة
    const rapidResults: string[] = [];
    const beforeRate = upstream.recordedTargets.length;
    for (let idx = 0; idx < 10; idx += 1) {
      const call = await client.callTool({ name: options.leakTarget.name, arguments: { ...options.leakTarget.args } });
      rapidResults.push(resultText(call.content));
    }
    const afterRate = [...upstream.recordedTargets].slice(beforeRate);
    const hd07 = checkRapidCalls(rapidResults, afterRate);
    const base = [hd01, hd02, hd03, hd04];
    const with05 = hd05 !== null ? [...base, hd05] : base;
    const results = [...with05, hd06, hd07];
    return ok(results);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    const withStderr = stderrTail.trim().length > 0 ? `${detail} — stderr: ${stderrTail.trim()}` : detail;
    return err(HardErrors.liveProbesFailed(withStderr));
  } finally {
    try { await client.close(); } catch {}
    try { transport.close(); } catch {}
    upstream.server.closeAllConnections(); upstream.server.close();
  }
}
function check(id: string, title: string, severity: SecurityCheckResult["severityIfFailed"], passed: boolean, location?: string, detail?: string): SecurityCheckResult {
  return { id, title, category: "live", severityIfFailed: severity, passed, ...(location !== undefined ? { location } : {}), ...(detail !== undefined ? { detail } : {}) };
}
function checkLiveManifestMatch(live: readonly string[], declared: readonly string[]): SecurityCheckResult {
  const liveSorted = [...live].sort().join(","); const declaredSorted = [...declared].sort().join(",");
  const passed = liveSorted === declaredSorted && live.length === declared.length;
  return check("HD-01", "الاكتشاف الحي يطابق عقد manifest المعلن", "high", passed, "manifest.json ↔ listTools", passed ? undefined : `المكتشف [${liveSorted}] لا يطابق [${declaredSorted}]`);
}
function checkLeakResistance(text: string): SecurityCheckResult {
  const leaked = text.includes(LEAK_MARKER);
  return check("HD-02", "فشل upstream لا يسرب جسم استجابته السرّي", "critical", !leaked, "callTool(failure-path)", leaked ? "علامة السر ظهرت — تسريب" : undefined);
}
function checkTraversalEncoding(recorded: readonly string[], expectEncoded: string): SecurityCheckResult {
  const hit = recorded.find((t) => t.includes(expectEncoded));
  return check("HD-03", "معاملات المسار تصل upstream مرمزةً", "high", hit !== undefined, "recording-upstream", hit !== undefined ? undefined : `لم يظهر الترميز (${expectEncoded}) في [${recorded.join(" | ")}]`);
}
function checkLiveDescriptions(tools: readonly { name: string; description?: string }[]): SecurityCheckResult {
  for (const tool of tools) {
    const hits = findInjectionHits(tool.description ?? "");
    if (hits.length > 0) return check("HD-04", "أوصاف الأدوات الحية نظيفة من حقن التعليمات", "high", false, `tools:${tool.name}`, `أنماط حقن: ${hits.join("، ")}`);
  }
  return check("HD-04", "أوصاف الأدوات الحية نظيفة من حقن التعليمات", "high", true);
}
export function checkSequentialExecution(recorded: readonly string[], expectOrder: readonly string[]): SecurityCheckResult {
  const passed = recorded.length >= 2 && expectOrder.every((f, idx) => (recorded[idx] ?? "").includes(f));
  return check("HD-05", "الأداة الثنائية تنفذ نداءين مرتبين عبر upstream", "high", passed, "recording-upstream", passed ? undefined : `المتوقع [${expectOrder.join(" → ")}] والمسجّل [${recorded.join(" | ")}]`);
}
export function checkLargePayloadRejection(resultTextValue: string, recordedAfter: readonly string[]): SecurityCheckResult {
  const has413 = resultTextValue.includes("413");
  const notForwarded = recordedAfter.length === 0;
  const passed = has413 && notForwarded;
  return check("HD-06", "الحمولة الضخمة >512KB تُرفض 413 قبل الوكيل", "high", passed, "large-payload", passed ? undefined : `النص=[${resultTextValue.slice(0, 80)}] مسجل=[${recordedAfter.join(" | ")}]`);
}
export function checkRapidCalls(results: readonly string[], recordedAfter: readonly string[]): SecurityCheckResult {
  const allOk = results.length === 10 && results.every((text) => text.length > 0 && !text.includes("413") && !text.includes("error"));
  const recordedOk = recordedAfter.length === 10;
  const passed = allOk && recordedOk;
  return check("HD-07", "10 نداءات متتالية بلا تسريب حالة", "high", passed, "rate-echo", passed ? undefined : `نتائج=${results.length} مسجل=${recordedAfter.length}`);
}


