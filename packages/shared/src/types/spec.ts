/**
 * أنواع المواصفة المطبّعة — مخرجات نظام الاستيعاب والتحليل.
 *
 * هذه الأنواع هي "لغة التداول" بين spec-parser و analyzer و generator.
 * كل ما يولده المحلل الحتمي هنا، وكل اقتراحات الوكلاء تُثبَّت بمراجع
 * (JsonPointer) تشير إلى هذا الهيكل لضمان قابلية التحقق.
 */

import { z } from "zod";

/** تصنيف endpoint من منظور العمل — يحدد لاحقاً جدوى تحويله لأداة */
export const EndpointKind = z.enum(["read", "write", "management", "admin"]);
export type EndpointKind = z.infer<typeof EndpointKind>;

/** مستوى الخطورة المعتمد للعمليات (يغذي قرار الأداة والشهادة) */
export const RiskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

/** إصابة بيانات شخصية اكتشفها الماسح في حقل معين */
export interface PiiHit {
  /** مسار الحقل داخل المواصفة بصيغة JsonPointer */
  readonly pointer: string;
  /** نوع البيانات الشخصية: email/phone/name/health/financial... */
  readonly piiType: string;
}

/** موقع الحقل داخل الطلب — يحدد حساسيته الأمنية ومسار تتبعه */
export const FieldLocation = z.enum(["path", "query", "header", "cookie", "body"]);
export type FieldLocation = z.infer<typeof FieldLocation>;

/** حقل مطبّع مستخرج من معاملات العملية أو مخطط جسم الطلب أو الاستجابة.
 *  هو وحدة عمل ماسح PII: كل إصابة PII تشير إلى أحد هذه الحقول بمؤشره. */
export interface FieldDescriptor {
  /** مسار الحقل داخل المستند الأصلي بصيغة JsonPointer */
  readonly pointer: string;
  /** اسم الحقل كما ورد في المواصفة */
  readonly name: string;
  /** موقعه في الطلب/الاستجابة */
  readonly location: FieldLocation;
  /** النوع المفتوح OpenAPI: string/number/boolean/object/array... */
  readonly openApiType: string;
  /** هل الحقل إلزامي؟ */
  readonly required: boolean;
}

/** نقطة نهاية مطبّعة: تم حل مراجعها وتوحيد شكلها مهما كان مصدرها */
export interface NormalizedEndpoint {
  /** مسار الـ HTTP مثل "/invoices/{id}" */
  readonly path: string;
  /** الفعل: get/post/put/patch/delete */
  readonly method: string;
  /** operationId إن ورد أو مركّب آمن من المسار والفعل */
  readonly operationId: string;
  /** ملخص مولّد حتمياً من summary/description الأصليين */
  readonly summary: string;
  /** أسماء معاملات المسار الإلزامية */
  readonly pathParams: readonly string[];
  /** هل تتطلب مصادقة؟ — مشتق من security (توافق خلفي؛ المصدر النموذج أدناه) */
  readonly requiresAuth: boolean;
  /**
   * النموذج الأمني faithful: بدل انهيار المخططات إلى requiresAuth
   * نحفظ الدلالات كما هي: OR بين بدائل Security Requirement Objects،
   * AND بين schemes داخل البديل الواحد مع scopes كل scheme.
   * undefined = غياب security في العملية والجذر معاً؛ [] = إعلان «عام» صريح.
   */
  readonly security: SecurityModel;
  /** كل حقول العملية مطبّعة (معاملات + جسم الطلب + الاستجابات) */
  readonly fields: readonly FieldDescriptor[];
}

/** استخدام scheme واحد داخل بديل أمني: اسمه وscopes المطلوبة معه (AND) */
export interface AuthSchemeUse {
  /** اسم scheme كما في components.securitySchemes */
  readonly name: string;
  /** scopes المطلوبة لهذا الـscheme في هذا المتطلب (oauth2/openIdConnect) */
  readonly scopes: readonly string[];
}

/** بديل أمني واحد: تتحقق المصادقة إذا تحققت كل استخداماته معاً (AND).
 *  البدائل المتعددة تعني «أي منها يكفي» (OR) — كما في OpenAPI حرفياً. */
export interface AuthAlternative {
  readonly schemes: readonly AuthSchemeUse[];
}

/** النموذج الأمني الكامل للعملية — لا اختزال ولا حماية ناقصة بصمت */
export interface SecurityModel {
  /** البدائل المقبولة (OR). [] = عام بلا مصادقة إعلاناً صريحاً */
  readonly alternatives: readonly AuthAlternative[];
  /** مصدر القرار: تعليمة العملية تتقدم على الجذر، أو لا شيء أصلاً */
  readonly source: "operation" | "global" | "none";
  /**
   * مراجع غير قابلة للنمذجة المدعومة: scheme غير معرّف في securitySchemes،
   * أو نوعه خارج المدعوم (basic/mutualTLS/apiKey-in-query/cookie...)،
   * أو بنية متطلب غير صالحة. غير فارغة ⇒ يجب رفض التوليد لا تخفيضه صمتاً.
   */
  readonly unsupported: readonly UnsupportedSecurityReason[];
}

/** سبب صريح لعدم قابلية النمذجة — يظهر في رفض التوليد برسالة عربية */
export interface UnsupportedSecurityReason {
  /** اسم الـscheme المرجعي أو "" لعيب بنية في المتطلب نفسه */
  readonly scheme: string;
  /** التصنيف: unknown-scheme | unsupported-type | unsupported-flow | malformed-requirement */
  readonly kind: "unknown-scheme" | "unsupported-type" | "unsupported-flow" | "malformed-requirement";
  /** شرح عربي موجز للسبب */
  readonly reason: string;
}

/** المواصفة بعد التطبيع الكامل — مدخل كل ما يليها */
export interface NormalizedSpec {
  /** عنوان API كما ورد في info.title */
  readonly title: string;
  /** إصدار OpenAPI الأصلي */
  readonly openapiVersion: string;
  /** عدد النقاط المطبّعة */
  readonly endpointCount: number;
  /** النقاط المطبّعة نفسها */
  readonly endpoints: readonly NormalizedEndpoint[];
}

/** النتيجة النهائية للتحليل: مواصفة + طبقة قرارات فوقها */
export interface AnalyzedSpec {
  /** المواصفة المطبّعة الأساس */
  readonly spec: NormalizedSpec;
  /** تصنيف كل endpoint بمفتاح operationId */
  readonly kinds: Readonly<Record<string, EndpointKind>>;
  /** درجة خطورة كل endpoint بمفتاح operationId */
  readonly risks: Readonly<Record<string, RiskLevel>>;
  /** إصابات PII المرصودة عبر المواصفة كلها */
  readonly piiHits: readonly PiiHit[];
  /** معرفات endpoints التي رشحها محلل الجدوية كمرشحة أدوات MCP */
  readonly mcpWorthyIds: readonly string[];
}

/* مخططات Zod للتحقق عند عبور حدود العملية (وتستخدمها snapshots الاستئناف) */

/** مخطط استخدام scheme: الاسم + scopes المرتبطة (AND داخل البديل) */
export const AuthSchemeUseSchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.string()),
});

/** مخطط بديل أمني: مجموعة AND من الاستخدامات؛ البدائل بينها OR */
export const AuthAlternativeSchema = z.object({
  schemes: z.array(AuthSchemeUseSchema),
});

/** مخطط النموذج الأمني الكامل — يشمل أسباب عدم الدعم صراحة */
export const SecurityModelSchema = z.object({
  alternatives: z.array(AuthAlternativeSchema),
  source: z.enum(["operation", "global", "none"]),
  unsupported: z.array(z.object({
    scheme: z.string(),
    kind: z.enum(["unknown-scheme", "unsupported-type", "unsupported-flow", "malformed-requirement"]),
    reason: z.string().min(1),
  })),
});

export const PiiHitSchema = z.object({
  pointer: z.string().min(1),
  piiType: z.string().min(1),
});

export const FieldDescriptorSchema = z.object({
  pointer: z.string().min(1),
  name: z.string().min(1),
  location: FieldLocation,
  openApiType: z.string().min(1),
  required: z.boolean(),
});

export const NormalizedEndpointSchema = z.object({
  path: z.string().min(1).startsWith("/"),
  method: z.enum(["get", "post", "put", "patch", "delete"]),
  operationId: z.string().min(1),
  summary: z.string(),
  pathParams: z.array(z.string()),
  requiresAuth: z.boolean(),
  security: SecurityModelSchema,
  fields: z.array(FieldDescriptorSchema),
});

export const NormalizedSpecSchema = z.object({
  title: z.string().min(1),
  openapiVersion: z.string().regex(/^3\.\d+\.\d+$/),
  endpointCount: z.number().int().positive(),
  endpoints: z.array(NormalizedEndpointSchema).min(1),
});

/** مخطط التحليل الكامل — يتحقق به كل AnalyzedSpec عابر لحدود عملية */
export const AnalyzedSpecSchema = z.object({
  spec: NormalizedSpecSchema,
  kinds: z.record(z.string(), EndpointKind),
  risks: z.record(z.string(), RiskLevel),
  piiHits: z.array(PiiHitSchema),
  mcpWorthyIds: z.array(z.string().min(1)),
});
