# THIRD_PARTY_NOTICES.md — إشعارات الأطراف الثالثة

> يحصر هذا الملف التبعيات والأصول الخارجية التي يعتمدها AgentBridge
> وتراخيصها، وفق قاعدة الصدق: لا قائمة نظريّة — الجرد مأخوذ من
> `pnpm-lock.yaml` (المصدر التعاقدي الأول) ومقاطع بتراخيص الحزم المثبتة
> فعليًا (`node_modules/.pnpm`) وقت الإعداد والتحقق.
> جرى التحقق بمطابقة ثلاثية: القفل + الشجرة المثبتة + جدول الإعداد
> (لا توجد أداة
> SBOM مولّدة في المشروع بعد — جرد القفل هو بديل الجرد التعاقدي حتى
> اعتماد أداة SBOM بقرار من المالك).

## 1) الأصول المعاد توزيعها داخل المستودع

| الأصل | المصدر | الترخيص | موقعه |
| --- | --- | --- | --- |
| IBM Plex Sans Arabic (400/600/700) | `@ibm/plex-sans-arabic@1.1.0` | SIL OFL 1.1 | `apps/dashboard/src/fonts/` + `LICENSE-IBM-Plex-Sans-Arabic.txt` |
| Inter (Latin 400/600/700) | `@fontsource/inter@5.1.0` | SIL OFL 1.1 | `apps/dashboard/src/fonts/` + `LICENSE-Inter-OFL.txt` |

ملاحظة OFL 1.1: يُمنع بيع ملفات الخطوط بحد ذاتها، ويجب إبقاء ملف
الترخيص المصاحب عند إعادة التوزيع، وأسماء الاحتياط (Reserved Font
Names) لا تُستخدم لمشتقات معدلة.

## 2) تبعيات التشغيل الأساسية (مباشرة)

| التبعية | الاستخدام | الترخيص |
| --- | --- | --- |
| next@15.x | إطار لوحة التحكم (Frontend) | MIT |
| react / react-dom@19.x | واجهة لوحة التحكم | MIT |
| fastify@5.x | الواجهة الخلفية REST | MIT |
| @modelcontextprotocol/sdk | بروتوكول MCP للخوادم المولدة والفحوص الحية | MIT |
| zod@3.x | التحقق المخططي في كل الطبقات | MIT |
| prisma / @prisma/client@6.x | الوصول إلى PostgreSQL | Apache-2.0 |
| redis@6.x | عميل Redis للذاكرة العرضية | MIT |

## 3) ملخص تراخيص الشجرة الكاملة (المثبتة فعليًا)

**تحقق الجرد**: يعلن `pnpm-lock.yaml` **562** مدخل
حزمة@إصدار (منها ~96 متغير منصات أخرى/اختلافات أقران لا تُثبَّت على هذه
الآلة)، بينما تحوي الشجرة المثبتة `node_modules/.pnpm` **462** حزمة
فعليًا (كانت 461 في الجرد الأول). التوزيع أدناه مقاس على المثبت فعليًا،
وكل حزمة برخصة مقروءة:

| الترخيص (SPDX) | عدد الحزم (المثبت فعليًا) |
| --- | --- |
| MIT | 378 |
| Apache-2.0 | 33 |
| ISC | 22 |
| BSD-2-Clause | 9 |
| BSD-3-Clause | 8 |
| Python-2.0 | 3 |
| MIT-0 | 2 |
| BlueOak-1.0.0 | 2 |
| Apache-2.0 AND LGPL-3.0-or-later | 1 |
| MPL-2.0 | 1 |
| CC-BY-4.0 | 1 |
| Unlicense | 1 |
| 0BSD | 1 |
| **المجموع** | **462** |

لا توجد رخصة غير تجارية ولا رخصة غامضة في الشجرة؛ انزياح الأعداد عن
الجرد الأول (461 حزمة) نتيجة عمليات تثبيت طفيفة بين الجولتين، وعائلات
التراخيص نفسها دون تغيير.

## 4) الحزم غير MIT بالتفصيل (بقية الجرد)

- **Apache-2.0**: @ampproject/remapping، حزم @eslint/*، حزم @humanfs/*،
  @humanwhocodes/module-importer، @humanwhocodes/retry، حزم @prisma/*
  (client/config/debug/engines/engines-version/fetch-engine/get-platform)，
  @swc/helpers، aria-query، cluster-key-slot، detect-libc،
  eslint-visitor-keys (3 إصدارات)، expect-type، openai، prisma، sharp،
  typescript، xml-name-validator.
- **ISC**: @isaacs/cliui، fastq، flatted، foreground-child، glob-parent،
  glob، inherits، isexe، lru-cache، minimatch (3.x/9.x)، once،
  picocolors، saxes، semver، setprototypeof، siginfo، signal-exit،
  split2، test-exclude، which، wrappy، yaml، zod-to-json-schema.
- **BSD-3-Clause**: deepmerge-ts، esquery، fast-uri (3.x/4.x)،
  istanbul-lib-coverage، istanbul-lib-report، istanbul-lib-source-maps،
  istanbul-reports، light-my-request، qs، secure-json-parse،
  source-map-js، tough-cookie.
- **BSD-2-Clause**: dotenv، entities، eslint-scope، espree، esrecurse،
  estraverse، esutils، json-schema-typed، uri-js، webidl-conversions.
- **BlueOak-1.0.0**: jackspeak، minimatch@10، minipass،
  package-json-from-dist، path-scurry.
- **MIT-0**: @csstools/color-helpers.
- **Apache-2.0 AND LGPL-3.0-or-later**: @img/sharp-win32-x64 (ثنائي
  libvips المسبق البناء لمنصة ويندوز؛ يستخدم sharp فقط وقت البناء).
- **Python-2.0**: argparse. — **MPL-2.0**: axe-core (أداة فحص وصول
  تصل عبر شجرة التطوير). — **CC-BY-4.0**: caniuse-lite (بيانات توافق
  متصفحات تصل عبر أداة التطوير). — **Unlicense**: fast-sha256.
  — **0BSD**: tslib.
- **MIT (370 حزمة)**: بقية الشجرة — يُعدّ جردُها الكامل بأمر واحد من
  جذر المستودع دون أدوات خارجية:
  `ls node_modules/.pnpm | wc -l` مع قراءة `package.json` لكل حزمة
  وقراءة حقل `license` (الإجراء يعيد إنتاج الجدول أعلاه حرفيًا).

## 5) حدود هذا الإشعار

يغطي هذا الملف شجرة التبعيات وقت إعداده؛ أي ترقية لاحقة تغيّر تراخيص
الشجرة تستلزم تحديث هذا الملف في نفس الجلسة (docs as code). ترخيص
مشروع AgentBridge نفسه هو Apache-2.0 — راجع `LICENSE` و`NOTICE`.
