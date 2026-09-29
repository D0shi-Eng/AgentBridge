/**
 * فحص الإقلاع fail-closed الإجمالي — منسّق الوحدتين:
 *   prisma-scope-role.ts   هوية الدور وصفاته وسلسلة عضويته
 *   prisma-scope-tables.ts الجداول المحمية الست عشرة وجودتها وملكها
 * الترتيب مقصود: فحص الجداول أولاً يستخرج أدوار المالكين، ثم فحص الشخصية
 * يرفض أي سلسلة عضوية تصل مالكاً — فلا طريق يصل التطبيق إلى ملكية تتجاوز RLS.
 * أي فشل يمنع الإقلاع (لا تراجع إلى الذاكرة — حكم المستدد).
 */
import type { PrismaClient } from "@prisma/client";
import { assertConnectionPersona } from "./prisma-scope-role.js";
import { assertProtectedTables } from "./prisma-scope-tables.js";

/** الدخول الإجمالي — يستدعى من resolve-stores عند PERSISTENCE=live */
export async function assertRestrictedRole(client: PrismaClient): Promise<void> {
  const ownerRoles = await assertProtectedTables(client);
  await assertConnectionPersona(client, ownerRoles);
}

export { RestrictedRoleError, EXPECTED_EXEC_ROLE } from "./prisma-scope-role.js";
export { PROTECTED_TABLES } from "./prisma-scope-tables.js";
