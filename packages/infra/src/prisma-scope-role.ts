/**
 * فحص هوية الدور fail-closed قبل أي استعلام عمل.
 *
 * ما يؤكده هذا الفحص قبل أي business query:
 *  - current_user يساوي الدور التنفيذي المتوقع من مصدر إعداد واحد (الثابت أدناه).
 *    غياب `options=-c role=…` يعني current_user=دور الجلسة نفسه ⇒ رفض mismatch.
 *  - session_user دور LOGIN نظيف الصفات عضوٌ بالدور التنفيذي (مباشرة أو بسلسلة).
 *  - الصفات (rolsuper/bypassrls/createdb/createrole) تُفحص على الجانبين معاً.
 *  - سلسلة العضوية تبدأ من session_user وتغطي التسلسل كاملاً؛ أي دور خارق
 *    في السلسلة (أو دور مالك جدول محمي) يرفض الإقلاع.
 * رموز الرفض ثابتة (خاصية code) ليُتحقق منها الاختبار بدقة لا بtoThrow عامة.
 */
import type { PrismaClient } from "@prisma/client";

/** المصدر الوحيد لاسم الدور التنفيذي المتوقع — لا يكرر في أي ملف آخر */
export const EXPECTED_EXEC_ROLE = "agentbridge_app";

/** خطأ فحص الدور برمز ثابت — الاختبارات تحقق code لا الرسالة وحدها */
export class RestrictedRoleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`فحص الدور المقيد رفض [${code}]: ${message}`);
    this.code = code;
    this.name = "RestrictedRoleError";
  }
}

interface PersonaRow {
  readonly session_user: string;
  readonly current_user: string;
  readonly session_canlogin: boolean;
  readonly session_rolsuper: boolean;
  readonly session_bypassrls: boolean;
  readonly session_createdb: boolean;
  readonly session_createrole: boolean;
  readonly exec_rolsuper: boolean;
  readonly exec_bypassrls: boolean;
  readonly exec_createdb: boolean;
  readonly exec_createrole: boolean;
}

/** صفات خارقة لأي من الطرفين — الرمز يميز الجلسة عن التنفيذ */
function assertPersonaAttributes(row: PersonaRow): void {
  if (row.session_rolsuper || row.session_bypassrls || row.session_createdb || row.session_createrole) {
    throw new RestrictedRoleError("AB_ROLE_ATTR_SESSION",
      `حساب الجلسة ${row.session_user} يحمل صفة خارقة (superuser/bypassrls/createdb/createrole)`);
  }
  if (row.exec_rolsuper || row.exec_bypassrls || row.exec_createdb || row.exec_createrole) {
    throw new RestrictedRoleError("AB_ROLE_ATTR_EXEC",
      `الدور التنفيذي ${row.current_user} يحمل صفة خارقة (superuser/bypassrls/createdb/createrole)`);
  }
}

/** سلسلة الأدوار من عضو معين — تغطي التسلسل العودي كاملاً من نقطة البداية */
const CHAIN_SQL = `
  WITH RECURSIVE chain AS (
    SELECT m.roleid::regrole::text AS role_name FROM pg_auth_members m WHERE m.member::regrole::text = $1::text
    UNION ALL
    SELECT p.roleid::regrole::text FROM pg_auth_members p JOIN chain c ON p.member::regrole::text = c.role_name
  ) SELECT role_name FROM chain`;

/**
 * الفحص الأول: من هو المتصل فعلاً؟
 * ترتيب الرفض: صفات خارقة (أي طرف) ⇒ عدم مطابقة الدور التنفيذي ⇒ جلسة
 * غير LOGIN ⇒ جلسة غير عضوة بالدور المتوقع ⇒ سلسلة عضوية غير نظيفة.
 * ownerRoles: أدوار مالكة الجداول المحمية — عضويتها في سلسلة الجلسة رفض.
 */
export async function assertConnectionPersona(client: PrismaClient, ownerRoles: readonly string[]): Promise<void> {
  const rows = await client.$queryRawUnsafe<Array<PersonaRow>>(
    `SELECT session_user, current_user,
            s.rolcanlogin AS session_canlogin,
            s.rolsuper AS session_rolsuper, s.rolbypassrls AS session_bypassrls,
            s.rolcreatedb AS session_createdb, s.rolcreaterole AS session_createrole,
            e.rolsuper AS exec_rolsuper, e.rolbypassrls AS exec_bypassrls,
            e.rolcreatedb AS exec_createdb, e.rolcreaterole AS exec_createrole
       FROM pg_roles s, pg_roles e
      WHERE s.rolname = session_user AND e.rolname = current_user`,
  );
  const row = rows[0];
  if (row === undefined) throw new RestrictedRoleError("AB_ROLE_UNKNOWN", "لا صف في pg_roles لحسابي الجلسة والتنفيذ الحاليين");
  // ترتيب الفحص مقصود: الصفات الخارقة تُكشف أولاً على أي من الطرفين
  // (رمز AB_ROLE_ATTR_*) ثم مطابقة اسم الدور التنفيذي (AB_ROLE_EXEC_MISMATCH)
  assertPersonaAttributes(row);
  if (row.current_user !== EXPECTED_EXEC_ROLE) {
    throw new RestrictedRoleError("AB_ROLE_EXEC_MISMATCH",
      `الدور التنفيذي current_user=${row.current_user} لا يطابق المتوقع ${EXPECTED_EXEC_ROLE} — غياب options=-c role أو دور خاطئ`);
  }
  if (row.session_canlogin === false) {
    throw new RestrictedRoleError("AB_ROLE_SESSION_UNTRUSTED", `حساب الجلسة ${row.session_user} ليس دور LOGIN مسموحاً`);
  }
  // هوية الجلسة يجب أن تكون عضواً بالدور التنفيذي المتوقع (سلسلة كاملة) —
  // حساب LOGIN أجنبي بدور تنفيذي نظيف لا يثق به الإقلاع
  const member = await client.$queryRawUnsafe<Array<{ role_name: string }>>(CHAIN_SQL, row.session_user);
  if (!member.some((entry) => entry.role_name === EXPECTED_EXEC_ROLE)) {
    throw new RestrictedRoleError("AB_ROLE_SESSION_UNTRUSTED",
      `حساب الجلسة ${row.session_user} ليس عضواً في ${EXPECTED_EXEC_ROLE} (بلا سلسلة عضوية)`);
  }
  await assertChainClean(client, row.session_user, ownerRoles);
}

/** سلسلة عضوية الجلسة لا تحتوي دوراً خارقاً ولا مالك جدول محمي */
export async function assertChainClean(client: PrismaClient, sessionUser: string, ownerRoles: readonly string[]): Promise<void> {
  const chain = await client.$queryRawUnsafe<Array<{ role_name: string }>>(CHAIN_SQL, sessionUser);
  const names = chain.map((entry) => entry.role_name);
  if (names.length === 0) return;
  const placeholders = names.map((_, index) => `$${index + 2}`).join(",");
  const dangerous = await client.$queryRawUnsafe<Array<{ rolname: string; why: string }>>(
    `SELECT rolname, CASE WHEN rolsuper THEN 'superuser' WHEN rolbypassrls THEN 'bypassrls'
                          WHEN rolcreatedb THEN 'createdb' WHEN rolcreaterole THEN 'createrole' END AS why
       FROM pg_roles WHERE rolname IN (${placeholders})
         AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)`,
    sessionUser, ...names,
  );
  if (dangerous.length > 0) {
    throw new RestrictedRoleError("AB_ROLE_MEMBERSHIP",
      `سلسلة أدوار الجلسة ${sessionUser} تصل أدواراً خارقة: ${dangerous.map((d) => `${d.rolname}/${d.why}`).join(", ")}`);
  }
  const ownerHit = names.find((name) => ownerRoles.includes(name));
  if (ownerHit !== undefined) {
    throw new RestrictedRoleError("AB_ROLE_MEMBERSHIP_OWNER",
      `سلسلة أدوار الجلسة ${sessionUser} تصل دور مالك جداول محمية: ${ownerHit}`);
  }
}
