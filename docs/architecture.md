# وثيقة المعمارية

## 1. النمط المعماري المعتمد

**Modular Monolith بحدود Hexagonal (بصلة معمارية)** — كل حزمة في `packages/` هي وحدة مستقلة بمنافذ (Ports) ومحولات (Adapters)، قابلة لاستخراجها كخدمة منفصلة مستقبلاً دون إعادة كتابة.

```
┌─────────────────────────────────────────────────────────┐
│  طبقة الواجهة Interface   (apps/api, apps/dashboard)     │
├─────────────────────────────────────────────────────────┤
│  طبقة التنسيق Orchestration (packages/orchestrator)      │
├─────────────────────────────────────────────────────────┤
│  طبقة التطبيق Application  (agents, generator, evaluator)│
├─────────────────────────────────────────────────────────┤
│  طبقة النطاق Domain        (shared types, analyzer rules)│
├─────────────────────────────────────────────────────────┤
│  طبقة البنية Infrastructure (infra: db, redis, llm, blob)│
└─────────────────────────────────────────────────────────┘
```

### قاعدة التبعية الحديدية
اعتماد المصدر يتجه نحو العقود الداخلية: `generator` يعرف `shared` ولا يعرف `apps/api`؛ Domain لا يعتمد على Infrastructure. المحولات تعتمد العقود وتنفذها، وتجميع التطبيق يصلها بالواجهات. ترتيب طبقات الرسم لا يمثل اتجاه الاستيراد ولا يساوي اتجاه تدفق التنفيذ.

## 2. تدفق البيانات الرئيسي (مسار المعالجة)

```
OpenAPI Spec
    │
    ▼
[1 Ingestion] ──► [2 Analysis] ──► [3 Tool Design] ──► [4 Generation]
                                                          │
                    ┌─────────────────────────────────────┘
                    ▼
            [5 Hardening] ──► [6 Evaluation] ──► [7 Certification]
                    ▲                 │
                    └── (Repair Loop) ┘
```

كل مرحلة عقدة في رسم بياني DAG حتمي (تفاصيل `orchestration.md`).

## 3. القرارات المعمارية (ADR مختصرة)

| # | القرار | السبب | البديل المرفوض |
| --- | --- | --- | --- |
| ADR-1 | TypeScript + Node | منظومة MCP SDK الأصلية TypeScript؛ توظيف أسهل | Rust/Go (بطء تطوير لفريق من فرد) |
| ADR-2 | Monorepo بـ pnpm | أصول مشتركة بأنواع صارمة بين الحزم | Repos متعددة (تعقيد مزامنة) |
| ADR-3 | Modular Monolith | سرعة تسليم فرد واحد؛ حدود جاهزة للتفكيك | Microservices منذ اليوم الأول (تكلفة تشغيل قاتلة) |
| ADR-4 | Fastify | أداء + نظام plugins ناضج | Express (غير مطور)، Nest (سطح ضخم) |
| ADR-5 | Zod لكل الحدود | تحقق موحد من المدخلات وخرائط LLM مع استنتاج أنواع | class-validator (ضعف الاستنتاج) |
| ADR-6 | PostgreSQL + Prisma | بيانات علائقية صارمة + pgvector للذاكرة الدلالية بنفس المحرك | MongoDB (علاقات المواصفات معقدة) |
| ADR-7 | Vitest | تكامل TS أصلي وسريع | Jest (تحويل ثنائي بطيء) |
| ADR-8 | تجريد مزوّد LLM (`packages/llm`) | عدم الارتباط بمورد؛ تبديل/مقارنة النماذج بضغطة | نداء مباشر لـ SDK مورد واحد |
| ADR-9 | مكتبة `yaml` (eemeli) لتحليل مواصفات YAML | متوافقة مع YAML 1.2، تُبلّغ عن موضع الخطأ بدقة، وتوفر حماية مضمنة ضد قنابل الاسم المستعار (`maxAliasCount`) — وهذا شرط أمني لاستيعاب ملفات من مصادر غير موثوقة | `js-yaml` (YAML 1.1 قديمة وحماية أضعف)، محلل ذاتي الصنع (خطر أمني وهشاشة) |
| ADR-10 | `typescript-eslint` للفحص الثابت | المفسر الرسمي الوحيد الذي يفهم TypeScript strict دون تكوين هش؛ يفعّل قاعدة منع `any` إلزامياً (القاعدة 14) | TSLint (متقادم ومهجور)، الاكتفاء بـ tsc (يفوّت أنماطاً مثل no-floating-promises) |
| ADR-11 | `@modelcontextprotocol/sdk` الرسمية لتشغيل بروتوكول MCP | التنفيذ المرجعي المعتمد: خادم `McpServer`/`StdioServerTransport` للخوادم المولدة وعميل `Client` لاختبارات القبول؛ يضمن توافق JSON-RPC وstdio مع بقية منظومة MCP | تنفيذ بروتوكول ذاتي الصنع (انحراف دائم عن مواصفة متحركة + عبء صيانة قاتل) |
| ADR-12 | تجزئة مفاتيح API بـ`node:crypto` scrypt بدل argon2id المذكورة في security.md §2 | scrypt هو KDF صلب الذاكرة مدمج في Node نفسها: صفر تبعيات أصلية (لا تجميع node-gyp ولا مخاطر سلسلة توريد)، معاملات موثقة ذاتياً في الـhash (`scrypt$N$r$p$salt$digest`) فالترقية لargon2id مستقبلية بلا هجرة بيانات — والتحقق بزمن شبه ثابت كما يشترط الأمان. الالتزام الجوهري لوثيقة 06 محفوظ: KDF صلب الذاكرة، لا استرجاع للمفتاح أبداً | إضافة حزمة `argon2` أصلية (بناء ثنائي لكل منصة مقابل كسب أمني غير ملموس عمليًا) |
| ADR-13 | عميل Redis الرسمي `redis` (node-redis v4) للذاكرة L1 — عبر محول فوق أصغر سطح أوامر | العميل الرسمي الصائن من Redis Ltd، يدعم streams/hashes/TTL أصلاً بنفس الدلالات الموثقة في memory.md §L1. المحول في `infra/redis-shape.ts` يستقبل واجهة ضيقة (`xAdd/xRange/hSet/hGetAll/expire`) مطابقة توقيعات v4 فيُختبر كاملاً بعميل مزيف دون منافذ حقيقية، والعميل الحقيقي يُمرر وقت النشر دون لمس أي منطق | ioredis (غير رسمي)، كتابة عميل خاص (خطر أمني وصيانة قاتلة) |
| ADR-14 | نقل المجيب الحتمي الموحد من apps/cli إلى packages/llm | api وcli يحتاجانه مصدراً واحداً — الازدواج يعني انحراف سلوك الوكلاء بين الواجهتين. أنماط حقن hardening تمرر معلمةً (`injectionPatterns`) حفاظاً على طبقة llm الأدنى دون أي دورة اعتماد | استيراد hardening داخل llm (قلب طبقات المعمارية)، نسخة ثانية في api (انحراف مؤكد مستقبلاً) |
| ADR-15 | كاتب ZIP مخزَّن مكتوب داخلياً في infra بدل مكتبة أرشفة (jszip/archiver) | تنزيل حزمة الخادم المولد يجب أن يصل بايت-بايت مطابقاً لما وُلّد؛ صيغة ZIP بطريقة التخزين (بلا ضغط) ثابتة وموثقة في PKWARE APPNOTE، وتنفيذها (~120 سطراً) يعطي: صفر تبعيات جديدة، حتمية كاملة (زمن DOS مثبت لا Date.now)، سطح أمني أصغر، واختبار تكاملي ضد tar.exe الفعلي على ويندوز | إضافة jszip/archiver (تبعية + سطح هجوم أكبر مقابل وظيفة ضغط لا نحتاجها لهذه الحزم الصغيرة) |
| ADR-16 | `@prisma/client@^6` + `prisma@^6` للذاكرة L2، و`redis@^6` للذاكرة L1 الحيّتين | Prisma 6 يحافظ على أسلوب `prisma-client-js` المتوافق مع مخططنا المرجعي؛ Prisma 7 يغير التوليد جذرياً. node-redis v6 يدعم streams/hashes/TTL المطلوبة للعقد ADR-13. كلاهما صفر تبعيات أصلية ويناسب حدود Hexagonal — العميل الرسمي يمرر للمحول كما هو، لا منطق جديد في المحول | Prisma 7 (توليد مختلف جذرياً)، ORM بديلة (عقود مختلفة)، ioredis (غير رسمي) |
| ADR-17 | `@anthropic-ai/sdk@^0.122` + `openai@^7` لمزودي الشبكة | العميلان الرسميان من الموردين أنفسهم: توقيعات مطابقة للتوثيق، تحديثات مواكبة للمواصفة، سطح أمان أصغر من استدعاء fetch يدوي؛ جدول أسعار ثابت داخل الملف (لا جلب شبكي — حتمية)، وتكلفة `estimateCostUsd(usage,model)` تُمرر لـ `CostLedger.addSpend` عبر `withBudgetGuard` | fetch يدوي (انحراف دائم عن المواصفة + عبء صيانة قاتل)، جلب أسعار شبكي (غير حتمي) |
| ADR-18 | `pgvector` + `openai@^7` (`text-embedding-3-small`) للذاكرة L3 الحية | امتداد PostgreSQL الرسمي الوحيد للمتجهات: فهرس `vector(1536)` مع مسافة جيب تمام حتمية؛ `openai` نفسه يضبط التضمين بنفس جدول الأخطاء الموحد (شبكة/429/5xx→retryable، فارغ→emptyResponse) — لا تضمينات مزيفة، والتحويل كله في `row-mappers.ts` (embeddingToRow/FromRow + cosineDistance) | مكتبة متجهات خارجية (Qdrant/Pinecone) (تعقيد تشغيلي وخروج عن Postgres الموحد)، تضمين حتمي FNV-1a للادعاء بإنتاجية |
| ADR-19 | SSE (`text/event-stream`) + حاوية مقيدة readOnly+non-root+seccomp | SSE هو بروتوكول البث القياسي للـHTTP: يبث نفس `LiveNdjsonStream` عبر `data: ...\n\n` بلا polling ولا WebSocket؛ الحاوية المقيدة بحدود `security.md §4` (readOnlyRootFilesystem/user 65532/cpus 1/memory 512m/pids 64/no-net) تحقق عزل التحصين الحي كما توثقه وثيقة الأمن، والتحقق البرمجي يثبت localhost-only | polling 1.2s (زمن وكُلفة مهدورة)، WebSocket (تعقيد ثنائي الاتجاه غير لازم)، تشغيل hardening بلا حاوية (سطح هجوم أوسع) |
| ADR-20 | دولاب التعلم L4 Flywheel — درس منظّم فوق Postgres + فهرسة في pgvector | الدروس `FlywheelLesson {tenant_id, spec_pattern, design_decision, outcome, score, lesson_json}` تُحفظ في L2 وتُفهرس نصياً في L3 عبر `PgVectorStore` بتضمين حتمي للدرس بلا نص خام حساس؛ `FlywheelStore {saveLesson/topK}` منفذ في `memory` ومحوله الحي `PrismaFlywheelStore` عبر `row-mappers.ts` (lessonToRow/FromRow نقية) + حقن `topK(hash,3)` في مطالب Designer/Repairer سياقاً إضافياً بلا تغيير عقد Zod — كل عميل يجعل التوليد أدق للجميع | تخزين الدروس في ملفات منفصلة (لا تعدد مستأجرين)، حفظ نص خام حساس في المتجهات (خرق memory.md §2)، تغيير عقد ToolDesign لإضافة سياق (كسر توافق) |
| ADR-21 | الضغط الحتمي `deflateRaw` + التنفيذ المتعدد `endpointIds>1` | `buildDeflatedZip` عبر `node:zlib` (deflateRaw حتمي بلا قاموس) يحافظ على `buildStoredZip` للتوافق ويختار المسار في `pipeline.route` حسب الحجم (>100KB⇒deflate وإلا stored) بنفس `content-type: application/zip`؛ الأداة المولدة تنفذ `endpointIds` بالتسلسل بترميز حتمي ونقل حقول الاستجابة السابقة عبر `previousResponse` — لا تغيير لـ `ToolDesign` (نفس Zod)، فقط القالب، و`HD-05` يثبت نداءين فعليين مرتبين | مكتبة ضغط خارجية (jszip/archiver) (سطح أوسع بلا حتمية)، تنفيذ متوازٍ بلا ترتيب (فقدان الاعتماد بين النداءين)، تغيير مخطط ToolDesign (كسر توافق العقد الحالي) |
| ADR-22 | واجهة إدارة L4 Flywheel + عزل مستأجر + حذف مزدوج L2/L3 | `FlywheelStore` يُوسع بـ `listRecent(tenantId,limit)` و`deleteLesson(tenantId,id)` مع تحقق بنيوي للمستأجر؛ `PrismaFlywheelStore` ينفذ فوق `flywheel_lessons` + يحذف الفهرس في L3 عبر `vectorStore.remove(tenantId,"tool",id)` — صف واحد في L2 = متجه واحد في L3، والحذف الذري للاثنين يبقي الطبقات متسقة؛ مسار `flywheel.route.ts` خلف `requireTenant` + Zod للاستعلام، والواجهة جدول بسيط + بحث topK + حذف بتوكيد عبر `flywheel-client.ts` النقي — لا تحليلات متقدمة خارج هذه الحدود | حذف من L2 وحده (تسريب متجهات قديمة تفسد topK لاحقاً)، تجاوز العزل بإرجاع كل الدروس (خرق security.md §8)، واجهة تحليلات معقدة (تضخيم بلا طلب عميل) |
| ADR-23 | التدويل i18n حتمي بقاموس `t(key,locale)` بلا مكتبة خارجية | `shared/i18n.ts` قاموس `ar/en` حتمي لكل مفاتيح `AppError` الحرجة + HITL/الشهادة بلا `any` ومع اختبار يثبت كل مفتاح له ترجمتان؛ `api/i18n.plugin.ts` يقرأ `Accept-Language/?lang=/x-tenant-locale`→`request.locale` افتراضي `ar` فلا تغيير سلوك حالي؛ `dashboard/lib/i18n.ts` يخزن `ab-locale` في localStorage + زر تبديل يغير `dir` بلا إعادة تحميل؛ الأنماط تحترم `dir` بلا `margin-left` ثابت — لا مكتبة intl تضخم الحزمة | `next-intl`/`i18next` (تبعية ثقيلة بلا حاجة لمجرد قاموس مفاتيح)، ترجمة شبكية LLM (غير حتمية ومكلفة) |
| ADR-24 | تحليلات Flywheel المتقدمة L4 — حساب حتمي فوق flywheel_lessons | `FlywheelStore.analytics(tenantId,range)` يحسب `totalLessons/avgScore/successRate/histogram[5]/topPatterns/trend` من `flywheel_lessons` حصراً باستعلام واحد `findMany` بفلتر `tenant_id+created_at>=cutoff` ثم تجميع نقي في الذاكرة عبر `row-mappers` فقط بلا منطق جديد في المحول؛ `GET /flywheel/analytics?range` خلف `requireTenant` + Zod enum، ولوحة `analytics/page.tsx` تعرض البطاقات والهيستوغرام وTrend عبر `flywheel-analytics-client.ts` النقي — صفر تبعيات تحليلية خارجية، والحساب حتمي: histogram خمس فئات (0-20..81-100) ومجموعها = total و successRate = success/total و topPatterns أعلى 5 تكراراً مرتبة count ثم avgScore | مكتبة تحليل خارجية (PostHog/Chart.js ثقيلة) (تضخيم بلا حاجة لمجرد تجميع عددي)، حساب في SQL بمنطق معقد (يفقد نقاء row-mappers ويكسر hexagonal) |
| ADR-25 | المراقبة التشغيلية + التصلب HD-06/07 + HB-11 | `MetricsRegistry` حتمي بلا تبعيات (`map<string,number>` لـ inc/histogram/snapshot) و `metrics.plugin.ts` يسجل `http_requests_total+duration` عبر `onResponse` ويكشف `GET /metrics` نص prometheus عاماً و `GET /health/detailed` خلف `requireTenant` (DB/Redis/pgvector)؛ التصلب يضيف `HD-06` (payload>512KB→413 قبل الوكيل) و `HD-07` (10 نداءات متتالية بلا تسريب) عبر `mock-upstream` (/large-echo + /rate-echo) مع `assertLocalhostOnly` وإلا `HARD_LIVE_PROBES_FAILED`، و `HB-11` قاعدة ساكنة تكشف `JSON.parse` بلا حد حجم في الكود المولد (medium) — كلها داخل الحاوية المقيدة `security.md §4` بلا شبكة خارجية | Prometheus client خارجي (تبعية ثقيلة بلا حاجة لعدادات بسيطة)، فحص حجم بعد الوصول للوكيل (يفقد هدف الحماية قبل المعالجة)، كشف JSON بلا حد عبر regex هش (يتجاوز الحالات المسموحة) |
| ADR-26 | تحقق OIDC حتمي بـ `node:crypto` فقط بلا مكتبة JWT ثقيلة | `oidc-verifier.ts` يجلب JWKS عبر `fetch` المحلي فقط ويتحقق `RS256` يدوياً: فك base64url للرأس والحمولة والتوقيع ثم `crypto.verify("RSA-SHA256", header.payload, jwk→KeyObject, signature)` مع فحوص `iss===issuer` و `aud===clientId` و `exp>now` و `kid` مطابق — لا `jsonwebtoken` ولا `jose` (سطح أصغر وحتمية كاملة وتوافق `strict` بلا `any`)؛ الأخطاء `SSO_JWKS_FAILED/TOKEN_INVALID/ISSUER_MISMATCH` عبر `AppError` وحارس `assertLocalhostOnly` يمنع جلب خارجي في الاختبارات الحية | مكتبة JWT ثقيلة (jsonwebtoken/jose) (تبعية + سطح هجوم أوسع + سلوك غير حتمي في تحقق exp/aud + وزن حزمة كبير مقابل 80 سطراً بـ crypto الأصلي) |
| ADR-27 | حوكمة SSO متعدد المستأجرين فوق `sso_configs` مع عزل بنيوي | جدول `SsoConfig {tenant_id @id, provider, issuer, client_id, jwks_url, enabled, created_at @@map("sso_configs")}` بمنفذ `SsoStore {get/upsert/delete}` عبر `sso-mappers.ts` النقية (ssoToRow/ssoFromRow) فقط بلا منطق في المحول؛ `PUT/GET/DELETE /sso/config` خلف `requireTenant` + دور `tenantAdmin` (حقل `is_admin` migration مرجعية) + Zod للجسم (issuer/jwks https فقط) و `POST /auth/oidc/callback` عام محدود يستقبل `id_token` ويتحقق عبر verifier ثم يصدر `Bearer` داخلي مؤقت — عزل A لا يرى B بنيوياً؛ `sso.plugin.ts` يحقن `request.ssoUser` ولا يسرب `jwksUrl`؛ `HB-12` تحجب `http` و `HD-08` يثبت رفض `iss` خاطئ 401 قبل upstream عبر `mock-oidc-provider` المحلي | تخزين SSO في ملف/Redis بلا جدول (لا تدقيق ولا انعزال)، تمرير jwksUrl بلا تحقق https (يسمح اختطاف)، عزل منطقي في المسار فقط (خرق security.md §8) |

## 4. قابلية التوسع

1. **الوضع الحالي**: Monorepo واحد يشغّل كل شيء.
2. **مسار النمو الجاهز**: فصل `generator` و`hardening` كـ workers مستقلة عبر طابور مهام (BullMQ على Redis) — الحدود المعمارية لهذا الفصل جاهزة دون إعادة كتابة.
3. **عملاء المؤسسات**: تعدد المستأجرين (multi-tenant) مدمج في مخطط قاعدة البيانات منذ البداية عبر `tenant_id`.

## 5. مبادئ ملزمة عند أي إضافة معمارية

- لا مكتبة جديدة إلا بقرار ADR موثق هنا.
- أي خدمة خارجية تُغلَّف خلف Port (واجهة) داخل `packages/infra`.
- أي حالة (state) تعبر حدود عملية يجب أن تكون قابلة للتسلسل JSON.

## قرارات إضافية — ADR-28 إلى ADR-31

- **ADR-28**: توليد بنيوي محدود السياقات دون تبعية runtime جديدة: literals للبيانات، computed properties للأشكال، معرفات مسبوقة متحققة، جمع literals وتعبيرات ثابتة للمسار. مقارنة AST وcorpus وبناء عينة SDK تثبت نطاق A01/A02 فقط. البديل AST runtime عبر TypeScript يزيد وزن المولد دون ضرورة لهذا القالب المحدود.
- **ADR-29**: عميل JWKS داخل infra بـNode DNS/HTTPS وZod القائمة؛ عنوان IP مفحوص ومثبت عبر lookup، TLS/SNI الأصليان، لا pool/redirect/proxy، وحدود زمن/بايت/تزامن. لا توسع لصلاحيات الوكلاء أو tenant admin. سياسة الشبكة العامة الأوسع تُنظَّم لاحقاً في وثيقة الأمن.
- **ADR-30**: cdxgen 12.8.4 أداة جرد مؤقتة خارج runtime، مثبتة دون scripts، مع منع كل child processes وتعطيل provenance/formulation منعًا لـGit. الناتج CycloneDX مصدر/قفل، لا صورة إنتاجية.
- **ADR-31**: تصحيحات متعدية مقيدة للإصدارات المتأثرة من qs إلى 6.16.0 وfast-uri إلى 3.1.6 عبر overrides محددة؛ الآباء يعلنون نطاقات ^6 و^3 المتوافقة. محاولة update بالاسم لم تحدث المتعدية. هذا ليس إخفاء تعارض: لا advisory يُستثنى من التقارير، ويلزم typecheck/lint واختبارات Fastify/API وSDK بعد المعالجة. postcss المثبت بالضبط في Next وVitest ذي الترقية الكبرى لا يُفرض عليهما override؛ يوثق انطباق الاستخدام والقيود في قائمة سماح تدقيق الاعتماديات `scripts/release/dependency-audit-allowlist.json`.

## قرارات الهوية الموثوقة — ADR-32 إلى ADR-34

- **ADR-32**: هوية موثوقة بمخزن خادمي: Principal اتحاد (user/service) في shared، وAuthStore/Membership/Session/LoginTransaction في memory كعقود نطاق، ومحول Prisma hash-only في infra. لا JWT في المتصفح؛ جلسة opaque عشوائية CSPRNG يخزن SHA-256 حصراً. المكتبات: صفر اعتماديات بروتوكول جديدة — OIDC/JWT فوق node:crypto وRS256 المثبت في قرارات التوليد السابقة يكفي الحد المطلوب وبدون توسيع سطح التبعيات.
- **ADR-33**: OIDC Authorization Code + PKCE S256 بمعاملة خادمية قصيرة العمر (state/nonce/verifier مشفرة AEAD بـAAD) من دون discovery ديناميكي؛ تبادل الرمز عبر قناة تبادل الرمز بنفس سياسة JWKS (HTTPS pinned، IP مفحوص، بلا redirect ولا تسريب secret). تحقق id_token فوق verifyOidcToken الموسع (nonce/azp/exp/nbf/iat/حجم). لا حفظ لتوكنات IdP ولا refresh token.
- **ADR-34**: عزل PgVector بمفتاح مركب `(tenant_id, run_id, id)` لم يكن مخالفة للعقد — أصل مشكلة التصادم العالمية في migration 20260905030000 وتشديد RLS بالدور المقيد؛ تعتمد RLS بقسم `SET LOCAL app.tenant_id` داخل المعاملة (`prisma-scope.ts`) فقط، ولا بديل شروط الاستعلام.
- **ADR-35**: عزل مقاييس المستأجرين — `GET /ops/metrics` (الجلسي الذي يغذي صفحة `/ops`) محصور بمشغّل التثبيت المحلي الفردي حصراً (`LOCAL_BOOTSTRAP=1` ومطابقة `localTenantId` مع `analytics:read`)، لأن `MetricsRegistry` عام يجمّع طلبات كل المستأجرين فقراءة مستأجر شبكي له تعدّ كشف نشاط غيره ولو كانت التسميات بلا أسماء. المستأجر الشبكي يُرفض 403 برمز `METRICS_OPERATOR_ONLY` وتعرضه اللوحة حالةً معلومة لا عطلًا مع بقاء `/health/detailed` الخاص به، و`GET /metrics` بالتوكن يبقى لجهاز جمع المقاييس الخارجي حصراً — بديل المقاييس لكل مستأجر مؤجل لأنه يستلزم عدادات موسومة بالمستأجر في المسار الساخن بلا حاجة تشغيلية اليوم.

