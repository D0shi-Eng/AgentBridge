/**
 * النموذج الأمني — لا اختزال مخططات أمن OpenAPI إلى boolean.
 *
 * المسؤولية الوحيدة: تحويل security (العملية/الجذر) + components.securitySchemes
 * إلى SecurityModel faithful: OR بين بدائل المتطلبات، AND بين الاستخدامات داخل
 * البديل، scopes محفوظة، والفرق بين غياب security وsecurity: [].
 * أي مرجع غير قابل للنمذجة المدعومة يدخل unsupported بسببه الصريح —
 * والمولد يرفض بناء حماية ناقصة بصمت (سياسة docs/security.md §5).
 * وحدة نقية 100%: لا شبكة ولا حالة ولا LLM — حتمية كاملة.
 */

import type { AuthAlternative, AuthSchemeUse, SecurityModel, UnsupportedSecurityReason } from "@agentbridge/shared";

/** أنواع schemes القابلة للنمذجة المدعومة — خارجها رفض لا تخفيض */
export const SUPPORTED_SCHEME_TYPES = new Set(["http", "apiKey", "oauth2", "openIdConnect"]);
/** sub-schemes المدعومة داخل http */
export const SUPPORTED_HTTP_SCHEMES = new Set(["bearer", "digest"]);
/** مواضع apiKey المدعومة — query/cookie مرفوضة أمنياً (تسرب/CSRF) */
export const SUPPORTED_APIKEY_LOCATIONS = new Set(["header"]);

/** تعريف scheme مستخلص من components.securitySchemes — الحد الأدنى للقرار */
export interface SecuritySchemeInfo {
  readonly type: string;
  /** http.scheme إن كان type=http (basic/bearer/digest/…) */
  readonly httpScheme?: string;
  /** apiKey في أي مكان (header/query/cookie) */
  readonly apiKeyIn?: string;
  /** oauth2: أسماء الـflows المعلنة */
  readonly flows?: readonly string[];
}

/** سجل schemes المعرّفة في المستند — مرجع التحقق من المراجع */
export type SecuritySchemes = ReadonlyMap<string, SecuritySchemeInfo>;

/** يستخلص components.securitySchemes كخريطة اسم→معلومات دنيا */
export function extractSecuritySchemes(doc: Record<string, unknown>): SecuritySchemes {
  const map = new Map<string, SecuritySchemeInfo>();
  const components = doc["components"];
  if (typeof components !== "object" || components === null) return map;
  const raw = (components as Record<string, unknown>)["securitySchemes"];
  if (typeof raw !== "object" || raw === null) return map;
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const def = value as Record<string, unknown>;
    const type = typeof def["type"] === "string" ? def["type"] : "";
    const info: SecuritySchemeInfo = {
      type,
      ...(typeof def["scheme"] === "string" ? { httpScheme: def["scheme"] } : {}),
      ...(typeof def["in"] === "string" ? { apiKeyIn: def["in"] } : {}),
      ...(typeof def["flows"] === "object" && def["flows"] !== null
        ? { flows: Object.keys(def["flows"] as Record<string, unknown>) }
        : {}),
    };
    map.set(name, info);
  }
  return map;
}

/** يفحص scheme واحداً ويدفع سببه إلى unsupported إن كان خارج المدعوم */
function classifyScheme(name: string, info: SecuritySchemeInfo | undefined, unsupported: UnsupportedSecurityReason[]): boolean {
  if (info === undefined) {
    unsupported.push({ scheme: name, kind: "unknown-scheme", reason: `securitySchemes لا يعرّف الـscheme "${name}" — المرجع معلق ولا يمكن نمذجته` });
    return false;
  }
  if (!SUPPORTED_SCHEME_TYPES.has(info.type)) {
    unsupported.push({ scheme: name, kind: "unsupported-type", reason: `نوع scheme "${name}" هو ${info.type || "غير معلن"} — خارج الأنواع المدعومة` });
    return false;
  }
  if (info.type === "http" && info.httpScheme !== undefined && !SUPPORTED_HTTP_SCHEMES.has(info.httpScheme)) {
    unsupported.push({ scheme: name, kind: "unsupported-type", reason: `http scheme "${info.httpScheme}" في "${name}" غير مدعوم — basic مثلاً يرسل بيانات اعتماد قابلة للفك` });
    return false;
  }
  if (info.type === "apiKey" && info.apiKeyIn !== undefined && !SUPPORTED_APIKEY_LOCATIONS.has(info.apiKeyIn)) {
    unsupported.push({ scheme: name, kind: "unsupported-type", reason: `apiKey في ${info.apiKeyIn} للـscheme "${name}" مرفوض — الترويسة فقط آمنة هنا` });
    return false;
  }
  if (info.type === "oauth2" && info.flows !== undefined && info.flows.length > 0 &&
      !info.flows.every((flow) => flow === "clientCredentials" || flow === "authorizationCode")) {
    unsupported.push({ scheme: name, kind: "unsupported-flow", reason: `oauth2 flows في "${name}" تشمل تدفقات غير مدعومة: ${info.flows.join("، ")}` });
    return false;
  }
  return true;
}

/** يحوّل متطلب أمنياً واحداً (كائن name→scopes) إلى بديل — مع كشف العيوب البنيوية */
function buildAlternative(
  entry: unknown,
  schemes: SecuritySchemes,
  unsupported: UnsupportedSecurityReason[],
): AuthAlternative | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    unsupported.push({ scheme: "", kind: "malformed-requirement", reason: "متطلب أمني ليس كائناً {schemeName: [scopes]}" });
    return null;
  }
  const uses: AuthSchemeUse[] = [];
  for (const [name, rawScopes] of Object.entries(entry as Record<string, unknown>)) {
    const scopeList = Array.isArray(rawScopes) ? rawScopes.filter((s): s is string => typeof s === "string") : [];
    if (rawScopes !== undefined && !Array.isArray(rawScopes)) {
      unsupported.push({ scheme: name, kind: "malformed-requirement", reason: `scopes الـscheme "${name}" يجب أن تكون مصفوفة نصوص` });
      return null;
    }
    uses.push({ name, scopes: scopeList });
    classifyScheme(name, schemes.get(name), unsupported);
  }
  return { schemes: uses };
}

/** خيارات بناء النموذج: تعليمة العملية ثم الجذر ثم لا شيء */
export interface SecurityModelInput {
  /** security الخاصة بالعملية — undefined تعني الغياب (لا override) */
  readonly operationSecurity?: readonly unknown[];
  /** security الجذرية للوراثة */
  readonly globalSecurity?: readonly unknown[];
  readonly schemes: SecuritySchemes;
}

/**
 * يبني النموذج الأمني faithful:
 * - تعليمة العملية (حتى []) تتقدم على الجذر — override صريح.
 * - غياب العملية → وراثة الجذر؛ غياب الاثنين → source:"none" وبدائل [].
 * - [] = «عام بلا مصادقة» إعلاناً صريحاً (source محفوظ، بدائل فارغة).
 * - كل بديل AND داخلي؛ البدائل بينها OR؛ المراجع غير المدعومة تُسجل لا تُهمَل.
 */
export function buildSecurityModel(input: SecurityModelInput): SecurityModel {
  const unsupported: UnsupportedSecurityReason[] = [];
  const fromOperation = input.operationSecurity !== undefined;
  const rawRequirements = fromOperation ? input.operationSecurity : input.globalSecurity;
  const source: SecurityModel["source"] = fromOperation ? "operation" : input.globalSecurity !== undefined ? "global" : "none";

  const alternatives: AuthAlternative[] = [];
  for (const entry of rawRequirements ?? []) {
    const alternative = buildAlternative(entry, input.schemes, unsupported);
    if (alternative !== null) alternatives.push(alternative);
  }
  return { alternatives, source, unsupported };
}

/** هل النموذج يتطلب مصادقة فعلياً؟ — مشتق وحيد لrequiresAuth التوافقي */
export function securityRequiresAuth(model: SecurityModel): boolean {
  return model.alternatives.length > 0;
}
