// إسناد ملكية جداول قاعدة البيانات إلى دور مالك نظيف الصفات — شرط فحص
// الجداول المحمية fail-closed (AB_TABLE_OWNER_INVALID): لا يصلح مالكًا
// دور يحمل صفة خارقة (superuser/bypassrls/createdb/createrole)، والهجرات
// تنفذ عادة بحساب المدير فتصبح الجداول ملكه — هذا السكربت يعيد الإسناد
// إلى دور مالك منفصل بلا أي صفات خارقة، بنمط tests/e2e/upgrade-harness.ts
// (جداول schema العامة حصرًا — REASSIGN OWNED الشامل يصطدم بكائنات نظام
// مطلوبة للقاعدة مملوكة للمستخدم البوتستراب فيرفضها PostgreSQL).
//
// الاستخدام من جذر المستودع بعد تطبيق الهجرات (idempotent — يُعاد بعد كل
// migrate deploy لأن الهجرات الجديدة تنشئ جداول باسم المدير من جديد):
//   node scripts/assign-database-owner.mjs
// متغيرات اختيارية: AB_PG_CONTAINER (افتراضي agentbridge-dev-postgres)
//   وAB_ADMIN_ROLE (افتراضي agentbridge) وAB_OWNER_ROLE (افتراضي
//   agentbridge_owner) وAB_DATABASE (افتراضي agentbridge).
// لا كلمات مرور هنا: الدور NOLOGIN بلا سر، والاتصال عبر docker exec
// بمصادقة المدير المحلية داخل الحاوية.
import { execSync } from "node:child_process";

const container = process.env.AB_PG_CONTAINER ?? "agentbridge-dev-postgres";
const adminRole = process.env.AB_ADMIN_ROLE ?? "agentbridge";
const ownerRole = process.env.AB_OWNER_ROLE ?? "agentbridge_owner";
const database = process.env.AB_DATABASE ?? "agentbridge";

// أسماء الأدوار من إعداد المشغل الموثوق — تُحقن بحرفية آمنة كمعرفات SQL
for (const name of [adminRole, ownerRole]) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(name)) {
    console.error(`اسم الدور '${name}' مخالف — المعرفات المسموحة: أحرف صغيرة وأرقام وشرطات سفلية`);
    process.exit(1);
  }
}

const sql = [
  `DO $$ BEGIN`,
  `  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${ownerRole}') THEN`,
  `    CREATE ROLE ${ownerRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;`,
  `  END IF;`,
  `END $$;`,
  `DO $$`,
  `DECLARE r RECORD;`,
  `BEGIN`,
  `  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner='${adminRole}' LOOP`,
  `    EXECUTE format('ALTER TABLE public.%I OWNER TO ${ownerRole}', r.tablename);`,
  `  END LOOP;`,
  `END $$;`,
].join("\n");
execSync(`docker exec -i ${container} psql -U ${adminRole} -d ${database} -v ON_ERROR_STOP=1`, {
  input: sql,
  stdio: ["pipe", "inherit", "inherit"],
  env: { ...process.env, PGPASSWORD: undefined },
});
console.log(`تم إسناد ملكية جداول قاعدة ${database} إلى الدور النظيف ${ownerRole} — فحص المالك fail-closed يمر الآن.`);
