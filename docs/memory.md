# طبقات الذاكرة

> أربع طبقات + دولاب تعلم. كل طبقة لها Port واجهة في `packages/memory` ومحولات تنفيذ في `packages/infra` — التبديل بين In-Memory (تطوير) و Redis/Postgres (إنتاج) لا يمس المنطق.

## L0 — ذاكرة العمل Working Memory
| البند | القيمة |
| --- | --- |
| المحتوى | سياق تشغيل واحد لمسار المعالجة: المرحلة الحالية، artifacts قيد التصنيع، نتائج آخر خطوة |
| الناقل | كائن `PipelineContext` داخل نفس العملية + snapshot كل مرحلة |
| العمر | يموت بانتهاء التشغيل؛ المهم يُرحَّل إلى L1 |

## L1 — الذاكرة العرضية Episodic (Redis)
| البند | القيمة |
| --- | --- |
| المحتوى | حالة مسارات المعالجة الجارية/الحديثة: أحداث المراحل، نقاط استئناف (resume points)، أقفال التزامن |
| البنية | Keys بنمط `pipeline:{id}:events` (stream) + `pipeline:{id}:state` (hash) |
| العمر | TTL 7 أيام ثم تُطرد للأرشيف البارد |

## L2 — الذاكرة الدلالية Semantic (PostgreSQL)
| البند | القيمة |
| --- | --- |
| المحتوى | الكيانات الدائمة: المستأجرون، المشاريع، المواصفات، التحليلات، الأدوات، الشهادات، سجل التدقيق |
| الضمانة | مصدر الحقيقة الوحيد — كل ما عداها قابل لإعادة البناء منها |

## L3 — الذاكرة المتجهية Vector (pgvector)
| البند | القيمة |
| --- | --- |
| المحتوى | تمثيلات دلالية (embeddings) لمقاطع المواصفات والأدوات المولدة والفشول السابقة |
| الاستخدام | `search_spec` للوكيل المصمم · استرجاع أنماط إصلاح مشابهة عند الفشل · تجميع أدوات متشابهة عبر العملاء لتدريب القوالب |
| الضمانة | يمكن حذفها وإعادة فهرستها من L2 دون فقدان معلومات |

## L4 — دولاب التعلم Flywheel
- بعد كل تشغيل ناجح/فاشل يُستخرج "درس" منظّم: (نمط مواصفة → قرار تصميم → نتيجة) بتحقق Zod.
- الدروس تُخزن في L2 بجدول `FlywheelLesson {id, tenant_id, spec_pattern, design_decision, outcome, score, lesson_json, created_at @@index([tenant_id])}` وتُفهرس في L3 عبر `PgVectorStore` بتضمين حتمي 1536 للدرس بلا نص خام حساس.
- المنفذ `FlywheelStore {saveLesson/topK/listRecent/deleteLesson/analytics}` في `memory/flywheel.ts` (≤200) ومحوله الحي `PrismaFlywheelStore` فوق `flywheel-mappers.ts` (lessonToRow/FromRow نقية) مع حذف مزدوج L2+L3 + `VectorStore.remove`؛ الحقن `topK(hash,3,tenantId)` سياقاً إضافياً بلا تغيير Zod؛ **analytics**: `analytics(tenantId,range)` حتمي — `histogram` 5 فئات (0-20..81-100) + `successRate=success/total` + `topPatterns` أعلى 5 تكراراً مرتبة count ثم avgScore + `trend` N أيام، محسوب من `flywheel_lessons` حصراً باستعلام واحد `findMany` بفلتر `tenant_id+created_at>=cutoff(range)` ثم تجميع نقي في الذاكرة عبر row-mappers فقط.
- **واجهة الإدارة**: `GET /flywheel/lessons` (قائمة أحدث 50 بترتيب score) + `GET /flywheel/lessons?query=&k=3` (بحث topK معزول) + `DELETE /flywheel/lessons/:id` (حذف مع عزل وحذف فهرس L3) خلف `requireTenant` + Zod؛ اللوحة `flywheel/page.tsx` جدول + بحث + حذف بتوكيد + EmptyState/Skeleton/Toast عبر `flywheel-client.ts` النقي.
- **تحليلات**: `GET /flywheel/analytics?range=7d|30d|90d` خلف `requireTenant` + Zod enum يعيد `{totalLessons,avgScore,successRate,histogram[5],topPatterns,trend}` معزولاً بنيوياً (A لا يرى B) وحتمياً (histogram sum=total)؛ اللوحة `flywheel/analytics/page.tsx` بطاقات + هيستوغرام 5 أعمدة + جدول TopPatterns + Trend 7/30/90 مع EmptyState/Skeleton/Toast عبر `flywheel-analytics-client.ts` النقي + `t()` بلا نص حرفي خارج القاموس.
- **هذه هي الخندق التنافسي**: كل عميل جديد يجعل التوليد أدق للجميع.

## قواعد عامة

1. **لا ذاكرة بلا مستأجر**: كل مفاتيح الطبقات تبدأ بـ `tenant_id`.
2. **الخصوصية**: PII لا يدخل L1/L3 إلا مُحوّراً؛ L3 تخزن embeddings فقط وليس نصاً خاماً حساساً.
3. **قابلية الإعادة**: أي تشغيل يجب أن يكون قابلاً لإعادة بنائه بالكامل من (مواصفة L2 + أحداث L1 المؤرشفة) — اختبار دوري لهذا يسمى "اختبار الطيور". **مكتمل**: `tests/e2e/phoenix.spec.ts` يشغّل مواصفة واقعية كاملة (CRM عيادات) حتى بوابة المراجعة البشرية في عملية، ثم يبني عمليات جديدة حول مخزنتي L1/L2 وحدهما ويستأنف حتى الشهادة — بمطابقة ملزمة لبادئة الأحداث حرفياً وبصمة المخرجات وقرار /verify العلني؛ ويثبت الاختبار الثاني حتمية البصمة نفسها عبر تشغيلين مستقلين لمواصفة الواقعية الثانية. **مكتمل**: `tests/e2e/phoenix-live.spec.ts` يعيد نفس السيناريو فوق PostgreSQL+Redis فعليين عبر عمليتين مستقلتين — عملية A تخمد حتى HITL، عملية B تستأنف من المخزنتين الحيتين وحدهما بمطابقة حرفية للأحداث والشهادة والبصمة وقرار /verify؛ وverifyChain تُبنى سليمة فوق صفوف حية ثم تُكسر بعبث واحد مباشر في القاعدة بموضعه الدقيق.

## التنفيذ الفعلي

| الطبقة | المنفذ (packages/memory) | المحولات | الحالة |
| --- | --- | --- | --- |
| L0 | `PipelineContext` في orchestrator — لا شيء هنا عمداً | — | ✅ |
| L1 العرضية | `EpisodicStore`: أحداث stream + state hash (status/snapshot) بمفاتيح `pipeline:{tenantId}:{runId}:events` / `:state` وعمر 7 أيام يجدد مع كل كتابة | InMemory كامل الوظائف (ساعة وTTL قابلان للحقن) + **محول Redis حي** فوق node-redis الرسمي (ADR-13) | ✅ (InMemory + Live) |
| L2 الدلالية | `SemanticStore`: tenants/projects/specs/pipelines/certificates/audit — كل دالة تستقبل tenantId معلمة أولى فلا استعلام بلا نطاق مستأجر (security.md §8) بنيوياً | InMemory بمفاتيح مركبة `tenant:id` + **PrismaSemanticStore الحي** فوق row-mappers النقية | ✅ (InMemory + Live) |
| L3 المتجهية | `VectorStore`: upsert/remove/search داخل نطاق مستأجر ومساحة، تضمين حتمي FNV-1a كيس-الكلمات بأبعاد 64 مطبّع L2، بلا نص خام إطلاقاً | InMemory بجيب تمام | ✅ |
| L3 الحي pgvector | `VectorStore` نفسه لكن فوق `pgvector` بمتجه 1536 عبر `OpenAiEmbeddingsProvider` (`text-embedding-3-small`) — نفس قواعد الشبكة نفسها (429/5xx→retryable، فارغ→emptyResponse)، والتحويل كله في `embedding-mappers.ts` (embeddingToRow/FromRow + cosineDistance حتمي)، و`PERSISTENCE=live` ⇒ `PgVectorStore` وإلا `InMemoryVectorStore`، واختبارات `pgvector-store.spec.ts` مشروطة (`skipIf`+`[تخطٍّ موثق]`) | InMemory + **PgVector حي** (`pgvector-store.ts` ≤200 عبر `$queryRaw`) + **OpenAiEmbeddingsProvider** (≤200) | ✅ |
| L4 دولاب التعلم | `FlywheelStore`: saveLesson/topK/listRecent/deleteLesson/analytics مع Lesson {id?, specPattern, designDecision, outcome, score, tenantId, createdAt} بتحقق Zod + حذف فهرس L3 + analytics(range) | InMemory حتمي (مع vectorStore للحذف) + **PrismaFlywheelStore الحي** فوق row-mappers + فهرسة/حذف في L3 بتضمين حتمي 1536 + واجهة `flywheel.route.ts` و `flywheel/page.tsx` + **تحليلات** `flywheel-analytics.route.ts` + `flywheel/analytics/page.tsx` عبر `flywheel-analytics-client.ts` (≤200) | ✅ (InMemory + Live + UI + Analytics) |

### سجل التدقيق (security.md §7) — الجسر بين مسار المعالجة والطبقات
- الصف الموحد `AuditTrailEntry` في shared: `{seq, tenantId, runId, stage, decision, abstractedPayload, at, prevHash, hash}`.
- `HashChainAuditLog` في infra يسجل بطابور لكل مستأجر (لا سباق تحت التزامن) ويكتب عبر منفذ `AuditSink` الضيق المطابق بنيوياً لـSemanticStore.
- `verifyChain(tenantId)` يعيد Result: يعيد بناء السلسلة كاملة (تسلسل seq، الوصل بالسابق من GENESIS، إعادة حساب كل hash) وأول خلل يعاد بموضعه الدقيق.
- الترحيل يتم في run-service عبر onEvent: كل حدث مسار وكل قرار بوابة يدخل السلسلة بملخص مجرد يمر على مرشح redact قبل التخزين.

### الاستئناف عبر العملية
- snapshot المحرك موقعة SHA-256 وتتحقق الآن مخططياً حقل-بحقل (مخططات NormalizedSpec/AnalyzedSpec/ToolDesign/GeneratedServerArtifact/SecurityReport/AuditedFinding/QualityScore/Certificate في shared) — أي حقل مجهول أو مخالف يرفض قبل الثقة به.
- المخازن (L1/L2) هي ما يعبر حدود العملية كما يفعل Redis/Postgres فعلاً؛ الحاوية تُبنى من جديد حولها فلا حالة تطبيق متبقية خارجها.
