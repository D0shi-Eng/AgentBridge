# GOVERNANCE.md — حاكمية المشروع

> English summary at the bottom. النص العربي هو الحاكم.

## النموذج الحاكم الحالي

AgentBridge اليوم مشروع بمرحلة تأسيسية بنموذج **قائد المشروع
(BDFL-mono)**: قرار المالك (project owner) هو المرجع الأعلى في كل ما
لا تغطيه وثيقة مكتوبة. هذا النموذج صادق مع واقع المشروع: مالك واحد
يحمل قرار المنتج والنشر والترخيص، ووكلاء تنفيذ (بشريون وآليون) يعملون
ضمن قواعد المشروع الملزمة الموثقة هنا وفي `CONTRIBUTING.md`.

## الأدوار

| الدور | من يملكه | الصلاحيات |
| --- | --- | --- |
| Project Owner | مالك المشروع | القرار النهائي في المنتج، النشر، الترخيص، القنوات العامة، وقبول أي مساهمة |
| Maintainer | يُعين بقرار من المالك | مراجعة طلبات الدمج، وحماية معايير الجودة، وإدارة الإصدارات |
| Contributor | أي ملتزم بـ CoC وCONTRIBUTING | اقتراح تغييرات عبر سير العمل الموثق |

## القرارات

1. **القرارات اليومية** (تنفيذ نطاق معلن، إصلاحات، توثيق): يدور ضمن
   قواعد المشروع الموثقة دون احتياج لقرار خاص.
2. **القرارات المعمارية** (تبعية جديدة، تفكيك وحدة، تغيير عقد): تحتاج
   ADR موثقًا في `docs/architecture.md` قبل التنفيذ.
3. **القرارات المصيرية** (نشر مستودع عام، تفعيل قنوات مجتمع، إطلاق
   خدمة مدارة، تعديل الترخيص): حصرية للمالك، وتوثق في
   قنوات المشروع الرسمية عند اتخاذها.

## قرارات لا يتم إلا بموافقة المالك

- الإقرار بجاهزية المشروع للتشغيل الإنتاجي.
- أي نشر علني للمستودع أو تغيير في `LICENSE`/`NOTICE`.
- أي تعديل في عقود الأمن أو API أو قاعدة البيانات.
- إطلاق أي عرض تجاري مرتبط بالمشروع.

## تطور الحاكمية

عند انضمام مشرفين خارجيين، ينتقل المشروع تدريجيًا إلى نموذج
مشرفين (maintainer council) بقرار موثق من المالك يعدّل هذه الوثيقة:
قواعد الترقية، تصويت القرارات المعمارية، وحل التعارض. حتى ذلك الحين
تبقى هذه الوثيقة هي المرجع.

## English summary

Governance today is a single project owner (BDFL-style) with the
final call on product, publishing, licensing, and public channels;
maintainers review and protect quality gates; contributors follow
CONTRIBUTING and CoC. Architecture decisions need an ADR; owner-only
decisions include declaring production readiness, publishing the
repository, changing LICENSE/NOTICE, security/API/DB contract
changes, and any commercial offer. A maintainer-council transition is
documented in this file when it happens.
