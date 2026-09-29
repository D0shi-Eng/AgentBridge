// تجهيز حساب التشغيل المقيد — الدور الوحيد المسموح بتشغيل التطبيق فوق RLS
// الاستخدام من جذر المستودع بعد إقلاع docker-compose.dev.yaml:
//   AB_APP_PASSWORD='<كلمة-مرور-قوية-≥16-حرفاً>' node scripts/prepare-restricted-role.mjs
// كلمة المرور تمر عبر متغير بيئة للعملية الواحدة فقط — لا تدخل أي ملف
// ولا هجرة ولا سجل، وتُدوَّر بإعادة تشغيل السكربت (idempotent).
//
// عقيد التصميم:
// - ab_app NOINHERIT يبدأ الاتصال بدور agentbridge_app عبر
//   `options=-c role=agentbridge_app` مباشرة (بلا SET ROLE) —
//   بلا نافذة امتيازات — كما في tests/e2e/rls-live-harness.ts.
// - السكربت يطبع قالب DATABASE_URL يتضمن options (بمسافة حرفية — %20
//   يفشل عبر Prisma pool) ولا يطبع كلمة المرور ولا يكرر معامل options.
// - لا يمنح حساب التشغيل ملكية قاعدة أو schema أو جدول.
import { execSync } from "node:child_process";

const password = process.env.AB_APP_PASSWORD;
if (password === undefined || password.length < 16) {
  console.error("AB_APP_PASSWORD مفقود أو أقصر من 16 حرفاً — لا يُجهز حساب تشغيل ضعيف");
  process.exit(1);
}
const escaped = password.replaceAll("'", "''");
// العبوات idempotent: الدور يُنشأ إن غاب ويُضبط إن وجد؛ كلمة المرور تُصفر كل مرة
const sql = [
  `DO $$ BEGIN`,
  `  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ab_app') THEN`,
  `    CREATE ROLE ab_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;`,
  `  END IF;`,
  `  ALTER ROLE ab_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${escaped}';`,
  `  GRANT agentbridge_app TO ab_app;`,
  `END $$;`,
].join("\n");
const container = process.env.AB_PG_CONTAINER ?? "agentbridge-dev-postgres";
// host:port يُشتق من مصدر الإعداد الواحد (AB_LIVE_DATABASE_URL كما في حزمة
// infra) لا حرفية — بيئات بأسماء حاويات ومنافذ مختلفة تعمل بلا تعديل هنا.
const liveUrl = process.env.AB_LIVE_DATABASE_URL ?? "postgresql://agentbridge:agentbridge@localhost:5433/agentbridge";
const hostPort = liveUrl.replace(/^[a-z]+:\/\/[^/]+@/u, "").replace(/\/.*$/u, "");
execSync(`docker exec -i ${container} psql -U agentbridge -d agentbridge -v ON_ERROR_STOP=1`, {
  input: sql,
  stdio: ["pipe", "inherit", "inherit"],
  env: { ...process.env, PGPASSWORD: undefined },
});
// لا تسرب: العبوة نفسها لم تُطبع، وكلمة المرور لم تُكتب في أي ملف.
// القالب يتضمن options بوحدة جاهزة للنسخ — %20 يفشل عبر Prisma pool.
// Also ensure the escape sequences are literal (distanced) not percent-encoded, واللا مرور ثانٍ ل(options).
const template = `postgresql://ab_app:<كلمة-المرور>@${hostPort}/agentbridge?options=-c role=agentbridge_app`;
console.log("تم تجهيز ab_app — LOGIN NOINHERIT NOSUPERUSER/NOBYPASSRLS، يفتح اتصاله بدور agentbridge_app عبر options.");
console.log(`DATABASE_URL للتشغيل المقيد: ${template}`);
console.log("ملاحظة: العنوان يجب أن يتضمن options حرفياً — حذفه يفشل فحص الإقلاع fail-closed.");
