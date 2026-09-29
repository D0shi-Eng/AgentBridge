# الأنظمة الفرعية

> ثمانية أنظمة، لكل منها حزمة واضحة وعقد مدخلات/مخرجات. لا يتواصل نظامان مباشرة إلا عبر أنواع `shared` أو عبر المنسق.

## النظام 1: الاستيعاب Ingestion (`spec-parser`)
- **الوظيفة**: استقبال مواصفة OpenAPI (3.0/3.1) بصيغة JSON/YAML، التحقق من صحتها البنيوية، حل المراجع `$ref`، وإخراج **مواصفة مطبّعة** واحدة مسطحة.
- **المدخل**: نص خام أو ملف. **المخرج**: `NormalizedSpec` + قائمة أخطاء بنيوية إن وجدت.
- **قاعدة**: هذا النظام حتمي 100% — صفر نداءات LLM.

## النظام 2: التحليل Analysis (`analyzer`)
- **الوظيفة** أربعة محللات مستقلة:
  1. `endpoint-classifier`: تصنيف كل endpoint (قراءة/كتابة/إدارة/إدارية).
  2. `pii-scanner`: كشف حقول البيانات الشخصية (اسم، بريد، هاتف، صحي، مالي) بقواعد + أنماط regex.
  3. `risk-scorer`: درجة خطورة لكل عملية (حذف > تعديل > قراءة؛ بيانات PII ترفع الخطورة).
  4. `mcp-worthiness`: قرار "هل يستحق هذا الـ endpoint أن يصبح أداة MCP؟" (ليس كل API يستحق أن يصبح أدوات).
- **المخرج**: `AnalyzedSpec` (مواصفة مطبّعة + تحليلات).

## النظام 3: تصميم وتوليد الأدوات Generation (`generator`)
- **الوظيفة**: وكيل المصمم يحوّل التحليل إلى **أدوات MCP مصممة ذكياً** (دمج endpoints مترابطة في أداة واحدة عالية المستوى)، ثم `emitter` يولّد كود TypeScript لخادم MCP كامل مع وحدة OAuth 2.1.
- **المخرج**: `GeneratedServerArtifact` = كود + خريطة أدوات + manifest.

### 3.1 عقد التوليد (مثبت ومكتمل)
```
GenerationInput ──► generateServer() ──► GeneratedServerArtifact ──► writeArtifact() ──► مجلد جاهز للتشغيل
   {analyzed, designs, options}         {files[], toolNames}          (كتابة على القرص بحراس)
```
- **الحتمية**: نفس المدخل = نفس الملفات بايت ببايت. لا زمن ولا عشوائية داخل التوليد.
- **إعادة الفحص الدفاعي**: المولّد لا يثق بمخرَج الوكيل — يتحقق من كل `ToolDesign` بمخطط Zod ومن أن كل معامل يقابل حقلاً حقيقياً في endpoints المرتبطة (`GEN_UNKNOWN_PARAMETER` وإلا).
- **التنفيذ المتعدد الحقيقي**: الأداة المولدة تنفذ `endpointIds` بالتسلسل: كل نداء يمرر `upstream` مع ترميز مسار حتمي، ونقل حقول الاستجابة السابقة كمدخلات للاحق عبر `previousResponse` (عقد بسيط: `args[name] ?? previousResponse[name]`). لا تغيير لـ `ToolDesign` (نفس Zod)، فقط القالب `tools-template.ts` + `tool-codegen.ts` (`buildPathTemplateLiteralWithFallback`).

### 3.2 ملفات الخادم المولد
| الملف | الوظيفة |
| --- | --- |
| `package.json` | حزمة مستقلة تعلن `@modelcontextprotocol/sdk` و`zod` وسكربت `start` |
| `tsconfig.json` | صارم مطابق لجذر المونوريبو |
| `src/server.ts` | إقلاع `McpServer` فوق stdio وتسجيل الأدوات |
| `src/tools.ts` | أداة لكل ToolDesign: مخطط zod من المعاملات + نداء upstream |
| `src/upstream-client.ts` | عميل HTTP واحد: بناء URL/ترويسات، مهلة، رسائل خطأ منظفة بلا PII |
| `src/config.ts` | قراءة البيئة: `UPSTREAM_BASE_URL` إلزامي (فشل إقلاع إن غاب)، `UPSTREAM_API_KEY` اختياري |
| `README.md` | تشغيل واستخدام بالعربية |

### 3.3 حزمة `llm` (منفذ المزودين) — مزودو الشبكة (ADR-17) + التضمينات (ADR-18)
- **المنفذ** `LlmProvider.complete(request): Promise<Result<LlmResponse>>` — أي مزود مستقبلي (Anthropic/OpenAI/mock) ينفذ هذا وحده؛ الاستجابة تحمل `usage{inputTokens,outputTokens}` لتغذية التكلفة.
- **المحول الحتمي** `MockLlmProvider`: يستجيب بسكربت مرتّب أو دالة نقية من الطلب؛ للتطوير والاختبارات دون شبكة أو تكلفة (صفر usage).
- **المزودان الحيان** `AnthropicProvider` فوق `@anthropic-ai/sdk` و`OpenAIProvider` فوق `openai` — كلاهما ≤200 سطر، يحول LlmRequest→messages+system، يستخلص `text` + `usage`، يتحقق فراغ→`LlmErrors.emptyResponse`، وشبكة/429/5xx→`LlmErrors.providerFailed` (retryable)، وتكلفة `estimateXxxCostUsd(usage,model)` من جدول أسعار ثابت داخل الملف (لا جلب شبكي — حتمية) تُسجل عبر `CostLedger.addSpend` في `withBudgetGuard`.
- **مزود التضمينات الحي** `OpenAiEmbeddingsProvider` فوق `openai` (`text-embedding-3-small` 1536 بُعداً) — نفس قواعد الشبكة: 429/5xx→retryable، فارغ→emptyResponse، وسعر ثابت 0.02$ لكل 1M رمز (estimateEmbeddingCostUsd حتمي) — لا تضمينات مزيفة.
- **بوابة المخرجات** `parseStructuredOutput()` — البوابة 2 من طبقة الحقيقة: استخلاص JSON (مع أسوار ```json) ثم تحقق Zod صارم؛ أي خرج مخالف = `LLM_OUTPUT_INVALID` قابل للإصلاح، لا قبول صامت أبداً.
- **دفتر التكلفة** `CostLedger` + `createInMemoryCostLedger` + `PrismaCostLedger` (فوق `llm_spend` بزيادة ذرية) — `monthSpendUsd` للشهر الحالي، و`withBudgetGuard` يرفض قبل الإرسال عند السقف (`LLM_BUDGET_EXCEEDED` retryable=false) ويمرر القرار لسلسلة التدقيق.

## النظام 4: التحصين Hardening (`hardening`) — HD-05 · HB-11 + HD-06/07 + HB-12/13 + HD-08
- **الوظيفة**: هجوم على الخادم المولد قبل تسليمه عبر مجموعتين حتميتين:
  - **ساكنة** `HB-01..HB-13` على نص الـartifact: تنفيذ كود ديناميكي، وصول نظام/صدفة، شبكة خام خارج قناة upstream، استيراد ديناميكي، أسرار مضمّنة، حقن تعليمات في الأوصاف، غياب inputSchema، تسريب جسم الاستجابة في الأخطاء، تجاوز عقد البيئة، كذب manifest، **و HB-11: كشف `JSON.parse` بلا حد حجم 512KB في الكود المولد (medium)**، **و HB-12: `jwksUrl` عبر https فقط ويحجب http (medium)**، **و HB-13: مسح AST دلالي لحدود التنفيذ (استيرادات/استدعاءات) فوق فحص النص (high)**.
  - **حية** `HD-01..HD-08` على خادم مقلع فعلياً بعميل MCP رسمي فوق upstream محلي مسجل: مطابقة الاكتشاف الحي مع manifest، عدم تسريب فشل upstream السرّي، ترميز معاملات المسار (لا اجتياز)، نظافة الأوصاف الحية من الحقن، **و HD-05: تسلسل ثنائي يتحقق أن أداة ب`endpointIds=2` تنفذ نداءين فعليين مرتبين عبر mock-upstream**، **و HD-06: ضخامة المدخلات payload>512KB تُرفض 413 قبل الوكيل**، **و HD-07: معدل النداءات المتكرر 10 نداءات متتالية بلا تسريب حالة**، **و HD-08: توكن بـ `iss` خاطئ يُرفض 401 قبل أي وصول لـ upstream عبر `mock-oidc-provider` المحلي** (كلها عبر `mock-upstream` و`mock-oidc-provider` المحليين و`assertLocalhostOnly`).
- **المخرج**: `SecurityReport` بقائمة `SecurityFinding` — النظافة: حرجة=صفر، وإلا 100−(25·high+10·medium+3·info).

## النظام 5: التقييم Evaluation (`evaluator`)
- **الوكيل المقيم** (`agents/EvaluatorAgent`): يقيّم كل أداة بعيون وكيل AI مستهلك عبر بواباته: مخطط Zod صارم + تغطية كاملة بلا تكرار + بنود مبررة إلزامية، بحد 3 دورات تغذية راجعة. أداته `simulate_tool_call` تبني خطة نداء جافة حتمية (ترميز مسار، استعلام، جسم) — الدليل التنفيذي الحي للبوابة 4 يبقى في فحوص hardening الحية.
- **موثق المصادر** (`evaluator/citation-verifier`): البوابة 3 حتمياً — كل endpointIds موجود ورُشح mcpWorthy، وكل معامل يقابل حقلاً طلب حقيقياً، ومعاملات المسار إلزامية دائماً. مخالفة واحدة = إحالة للإصلاح.

## النظام 6: الشهادة Certification (`evaluator/certificate`)
- **الوظيفة**: دمج تقرير التحصين (ودرجات الجودة عند توفرها) في درجة نهائية 0–100. ≥ 85 = شهادة "Agent-Ready Verified" مع شارة SVG حتمية.
- **قاعدة رفض صارمة**: أي `SecurityFinding` من نوع حرج = فشل تلقائي بغض النظر عن الدرجة (تُكشف حتى لو أخفى التقرير راية hasCritical بإعادة فحص القائمة).
- **وزن الدمج حالياً**: الجودة غير متاحة بعد فالدرجة = نظافة التحصين؛ وعند توفرها تُدمج 60% أمان + 40% جودة، ويستبدل بنموذج الثقة المرجون الكامل عند بناء المقيم.
- **رقم التحقق**: `AB-<16 hex>` مشتق sha256 من بصمة artifacts (SHA-256 لملفاتها مرتبة بالمسمى) + الدرجة + زمن الإصدار.

## النظام 7: الحوكمة Governance (`infra` + `memory`) — L3 حية · L4 Flywheel · إدارة L4+i18n · تحليلات L4 + مراقبة · **SSO/OIDC**
- **سجل التدقيق**: append-only بسلسلة hash لكل حدث مسار وكل قرار بوابة — `HashChainAuditLog` بطابور إلحاق لكل مستأجر، و`verifyChain(tenantId)` يكشف أي عبث بموضعه (تفاصيل memory.md §التنفيذ).
- **تعدد المستأجرين**: فرض بنيوي على مستوى المنفذ — كل دالة استعلام في SemanticStore تستقبل tenantId معلمة أولى، ولا يوجد استعلام بلا نطاق أصلاً.
- **أسرار المنصة**: config بتحقق Zod عند الإقلاع برسائل عربية (غياب/ضعف ENCRYPTION_KEY = رفض)، logger بمرشح redact لأنماط المفاتيح، crypto بـAES-256-GCM + scrypt (ADR-12).
- **الذاكرة المتجهية L3 الحية**: `MemoryEmbedding` بمتجه 1536 + فهرس tenant_id فوق `pgvector`؛ المحول `PgVectorStore` ينفذ `VectorStore` بـ `$queryRaw` بلا منطق نطاق، والتحويل كله في `embedding-mappers.ts` (embeddingToRow/FromRow + cosineDistance حتمي) — لا تضمينات مزيفة، و`PERSISTENCE=live` ⇒ `PgVectorStore` وإلا `InMemoryVectorStore`.
- **دولاب التعلم L4**: جدول `FlywheelLesson` في L2 + فهرسة نص الدرس في L3 عبر `PgVectorStore` بتضمين حتمي 1536 بلا نص خام حساس؛ المنفذ `FlywheelStore {saveLesson/topK/listRecent/deleteLesson/analytics}` ومحوله الحي `PrismaFlywheelStore` عبر `flywheel-mappers.ts` (lessonToRow/FromRow نقية) + حساب `analytics(tenantId,range)` حتمي من `flywheel_lessons` باستعلام واحد `findMany` بفلتر `tenant_id+created_at>=cutoff` ثم تجميع نقي في الذاكرة (histogram 5 فئات، successRate، topPatterns 5، trend N أيام)؛ والحقن `topK(hash,3,tenantId)` في مطالب Designer/Repairer سياقاً إضافياً بلا تغيير عقد Zod؛ **واجهة الإدارة**: `GET /flywheel/lessons` (قائمة 50 بترتيب score + بحث topK) و `DELETE /flywheel/lessons/:id` خلف `requireTenant` مع حذف مزدوج L2+L3؛ **تحليلات**: `GET /flywheel/analytics?range=7d|30d|90d` خلف `requireTenant` + Zod enum يعيد `{totalLessons,avgScore,successRate,histogram[5],topPatterns,trend}` مع عزل بنيوي وحساب حتمي (histogram sum=total).
- **التدويل**: قاموس `shared/i18n.ts` الحتمي `t(key,locale,vars)` لكل رسائل AppError الحرجة + HITL/الشهادة، و `api/i18n.plugin.ts` يقرأ `?lang=/Accept-Language/x-tenant-locale` → `request.locale` (افتراضي ar)، و `dashboard/lib/i18n.ts` مع `ab-locale` + زر تبديل يغير `dir` بلا إعادة تحميل.
- **المراقبة التشغيلية**: `infra/metrics.ts` سجل `MetricsRegistry {inc,histogram,snapshot,toPrometheus}` حتمي بلا تبعيات (`Map<string,number>` فقط) و `api/metrics.plugin.ts` يسجل `http_requests_total{method,route,status} + http_request_duration_ms` عبر `onResponse` ويكشف `GET /metrics` عام نص prometheus و `GET /health/detailed` خلف `requireTenant` (DB/Redis/pgvector حالة) — بلا تسريب.
- **SSO/OIDC للمؤسسات**: جدول `SsoConfig {tenant_id @id, provider, issuer, client_id, jwks_url, enabled, created_at @@map("sso_configs")}` مع منفذ `SsoStore {get/upsert/delete}` عبر `sso-mappers.ts` النقية؛ `PUT/GET/DELETE /sso/config` خلف `requireTenant` + دور `tenantAdmin` (حقل `is_admin` في `tenants`) + Zod للجسم (issuer/jwks https فقط) و `POST /auth/oidc/callback` عام محدود يستقبل `id_token` ويتحقق عبر `oidc-verifier` ثم يصدر `Bearer` داخلي مؤقت — عزل A لا يرى B بنيوياً؛ `sso.plugin.ts` يحقن `request.ssoUser` ولا يسرب `jwksUrl`؛ `HB-12` تحجب `http` في `jwksUrl` و `HD-08` يثبت رفض `iss` خاطئ 401 قبل upstream عبر `mock-oidc-provider` المحلي.

## النظام 8: الواجهات Interfaces (`apps/api`, `apps/dashboard`) — api · لوحة تحكم كاملة · SSE وحاوية مقيدة · ضغط · L4+i18n · تحليلات ومراقبة
- **REST API** (Fastify): مصادقة API Keys مجزأة scrypt لكل مستأجر (`Bearer <tenant>:<secret>`، فشل موحد 401 بلا تسريب) · `i18n.plugin.ts` يقرأ `Accept-Language/?lang=/x-tenant-locale` → `request.locale` (افتراضي ar) و error-handler يترجم عبر `shared/i18n.ts` الحتمي · `metrics.plugin.ts` يسجل `http_requests_total{method,route,status} + http_request_duration_ms` ويكشف `GET /metrics` عام و `GET /health/detailed` خلف `requireTenant` · مسارات: health / projects / specs (رفع بحجم مقيّد 512KB) / pipelines: POST تشغيل (بخيار مراجعة بشرية) → 202 ثم status + events ببث NDJSON حي **و stream ببث SSE حقيقي `text/event-stream` يبث نفس LiveNdjsonStream عبر `data: ...\n\n` مع `Cache-Control: no-cache`** + tools (عرض أدوات HITL) + resume (= اعتماد) + reject + certificate/badge كمرفقات + **package.zip** (حزمة الخادم المولد — ADR-15 مخزن و ADR-21 مضغوط `deflateRaw` حتمي بلا قاموس؛ الاختيار حسب حجم الحزمة >100KB⇒deflate وإلا stored بنفس `content-type: application/zip`) + قائمة تشغيلات المستأجر + **stats** (إحصاءات المستأجر للنظرة العامة) + **verify/:verificationId** (قرار علني بقائمة بيضاء صارمة — السطح العام الثاني الوحيد) + **flywheel** `GET /flywheel/lessons(?query&k)` + `DELETE /flywheel/lessons/:id` (عزل بنيوي + حذف L2+L3) + **flywheel/analytics** `GET /flywheel/analytics?range=7d|30d|90d` معزول بنيوي + **SSO/OIDC** `PUT/GET/DELETE /sso/config` (خلف `requireTenant` + دور `tenantAdmin` + Zod https فقط) و `POST /auth/oidc/callback` (عام محدود، يتحقق `id_token` عبر `oidc-verifier` ويصدر Bearer داخلي) + **observability** `GET /metrics` عام و `GET /health/detailed` خلف مصادقة.
- **الشارة ترصد رابط التحقق**: `renderBadge(cert, {verifyUrl?})` يلف SVG بعنصر `<a>` مع تهريب XML؛ مسار الشارة يبني الرابط من ترويسات البروكسي القياسية ثم مضيف الطلب، مع تجاوز صريح آمن عبر `?verifyUrl=`. بلا خيار يبقى الناتج مطابقاً بايت-ببايت للنسخ السابقة.
- **التجميع**: container.ts يدوي صريح (config ← logger ← مخازن ← تدقيق ← خدمة تشغيل)؛ المحولات داخل الذاكرة افتراضياً والمحولات الشبكية تمر بنفس المنافذ عند توفرها. تصدير الحزمة للاختبارات عبر خريطة exports (app/container/test-helpers).
- **workDir**: مجلد مؤقت مُدار لكل تشغيل تحت tmproot يُمسح بعد الانتهاء مهما كانت النتيجة.
- **لوحة التحكم** (Next.js 15، بنظام تصميم كامل):
  - **نظام التصميم**: توكنز موحدة (`theme/tokens.css`: أخضر الثقة #22c55e + أزرق عميق، طبوط هندسي 1.25 من 14px، شبكة 8px، ظلال ثلاثة مستويات، حركة هادئة 150–250ms مع احترام prefers-reduced-motion)؛ مكونات ui/ عشرة RTL-first: Logo/Button/Card/Pill/DataTable/Skeleton/EmptyState/ToastProvider/Stepper/ScoreRing؛ شعار SVG وfavicon وOG tags وصورة مشاركة og.png. المنطق القابل للاختبار معزول في lib نقية (stepper-model/toast-store/stats/verify-model) بتغطية مفروضة ≥80%.
  - **مجموعة `(marketing)` العامة**: صفحة الهبوط `/` تشرح الفكرة لمدير غير تقني خلال 60 ثانية (Hero بلقطة لمسار المعالجة مبنية من مكونات اللوحة الحقيقية نفسها، قصة المشكلة بأرقام 400–800 ساعة، أربع خطوات، الأمان بـ14 فحصاً وسلسلة الهاش وHITL بأرقام المنتج الفعلية لا ادعاءات، أسعار MRR وFAQ) + صفحة `/verify/[verificationId]` العلنية التي تعرض القرار والدرجة والزمن والبصمة المقطوعة حصراً بلا أي بيانات مستأجر حساسة.
  - **مجموعة `(app)` الموثقة**: لوحة المستأجر على `/app` ببطاقات إحصاء حية فوق القوائم (تشغيلات/نشطة/شهادات/متوسط الدرجة من GET /stats)، رفع المواصفة بخيار HITL، حالات فراغ مصممة وهياكل تحميل وتنبيهات Toast بدل الصمت؛ صفحة التشغيل بـStepper المراحل الثماني (بحالات done/active/failed/repair الملوّنة المتحركة) وبوابة HITL وبطاقة شهادة بحلقة درجة موحدة وأزرار تنزيل الشهادة والشارة (برابط تحقق مرصود) وحزمة ZIP + صفحة **Flywheel تحليلات** `/flywheel/analytics` ببطاقات الإجمالي/المتوسط/معدل النجاح وهيستوغرام 5 أعمدة وجدول TopPatterns وTrend 7/30/90 يوم + صفحة **المراقبة** `/ops` تعرض مقاييس `GET /ops/metrics` الجلسي — محصورة بمشغّل التثبيت المحلي الفردي (ADR-35)، والمستأجر الشبكي يراها حالة معلومة محددة — وحالة `/health/detailed` لكل مستأجر مع زر تحديث + صفحة **إعدادات SSO** `/settings/sso` نموذج issuer/clientId/jwksUrl/enabled مع حالة مفعّل/معطّل وحفظ/حذف. كل النداءات عبر وكيل `/api/*` فلا CORS ولا تعريض مفاتيح.

## جدول الملكية (من يملك ماذا)

| النظام | الحزمة | يعتمد على |
| --- | --- | --- |
| الاستيعاب | spec-parser | shared |
| التحليل | analyzer | shared |
| التوليد | generator | shared, llm |
| التحصين | hardening | shared |
| الوكلاء | agents | shared, llm, hardening |
| التنسيق | orchestrator | جميع ما سبق عبر عقودها |
| الطرفية | apps/cli | orchestrator (+ حزمه عبره) |
| الذاكرة | memory | shared فقط (المنافذ + محولات InMemory) |
| البنية | infra | shared (+ أنواع memory نمطياً type-only للمحولات الشبكية) |
| الواجهات | apps/api, apps/dashboard | orchestrator, memory, infra |

> ملاحظة معمارية: المنافذ تعيش في memory والمحولات التقنية في infra، والاثنان يلتقيان في apps/container بالمطابقة البنيوية — لا اعتماد جرياني بين memory وinfra إطلاقاً، فتبديل أي محول لا يمس المنطق ولا المنافذ.

## ملاحظات تنفيذية إضافية

المولد يفصل بيانات OpenAPI/LLM عن بنية TypeScript عبر ممثلات سياق محددة، ويرفض العقود غير القابلة للتمثيل. `infra/jwks` محول شبكة ينفذ سياسة الخروج الداخلية، ويستدعيه `oidc-verifier`؛ لا تعتمد طبقة domain على infra. Docker entrypoint بوابة تشغيل تفشل حتى يتوفر runner مبني فعليًا، ولا يمثل وجود Dockerfile خط إنتاج مكتملًا.
