/**
 * خدمة الجلسة — تحول سجلات المخزن إلى Principal بعد فحص الإلغاء والانتهاء
 * وحالة العضوية وإصدار التفويض، وتصدر القيم الخام مرة واحدة فقط.
 *
 * صلاحيات جلسة الجسر = تقاطع (صلاحيات الاعتماد ∩ allowlist
 * الجسر ∩ سياسة العضوية) — التقاطع هنا في العقد لا في مسار متصفح.
 * سلامة الجلسة — identityId يجب أن يطابق membership.identityId
 * عند الإصدار وعند المصادقة معاً؛ تعارض الصف يرفض الجلسة سلبياً.
 */
import { randomUUID } from "node:crypto";
import type { AuthStore, MembershipRecord, SessionRecord } from "@agentbridge/memory";
import { ROLE_PERMISSIONS, type Permission, type Principal } from "@agentbridge/shared";
import {
  SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, hashOpaqueToken, randomOpaqueToken,
} from "@agentbridge/infra";

export interface IssuedSession {
  readonly rawToken: string;
  readonly csrfToken: string;
  readonly record: SessionRecord;
}

/**
 * allowlist الجسر — الصلاحيات التي يحق لجسر API-key أن يمنحها
 * لجلسة مشتقة. sso:manage وtenant:admin وأي صلاحية إدارية بشرية محجوبة حصراً:
 * الجسر سطح متصفح خدمي، والإدارة البشرية تمر عبر OIDC فقط.
 */
export const BRIDGE_ALLOWLIST: ReadonlySet<Permission> = new Set<Permission>([
  "resource:read",
  "pipeline:run",
  "pipeline:review",
  "artifact:read",
  "flywheel:read",
  "flywheel:write",
  "analytics:read",
]);

/** تقاطع العقد: صلاحيات الجلسة = اعتماد ∩ allowlist ∩ صلاحيات دور العضوية */
export function bridgeSessionPermissions(
  credentialPermissions: readonly Permission[], membership: MembershipRecord,
): Permission[] {
  const rolePermissions = new Set(ROLE_PERMISSIONS[membership.role]);
  return credentialPermissions.filter((permission) => BRIDGE_ALLOWLIST.has(permission) && rolePermissions.has(permission));
}

export class SessionService {
  constructor(private readonly store: AuthStore, private readonly now: () => number = Date.now) {}

  async issue(
    identityId: string, membership: MembershipRecord, bindingHash: string,
    authMethod: "oidc" | "api_key_bridge" | "local_bootstrap", sessionPermissions?: readonly Permission[],
  ): Promise<IssuedSession> {
    // تعارض الهوية يرفض الإصدار قبل أي كتابة — لا جلسة بصف متضارب
    if (identityId !== membership.identityId) {
      throw new Error("تعارض هوية الجلسة: identityId لا يطابق membership.identityId");
    }
    const rawToken = randomOpaqueToken();
    const csrfToken = randomOpaqueToken();
    const now = this.now();
    const record: SessionRecord = {
      sessionId: randomUUID(), tokenHash: hashOpaqueToken(rawToken), csrfHash: hashOpaqueToken(csrfToken),
      browserBindingHash: bindingHash, identityId, authMethod, membershipId: membership.membershipId,
      tenantId: membership.tenantId,
      // صلاحيات الجلسة تُمرر صراحة لجسر API-key = صلاحيات
      // الاعتماد حصراً؛ والقيمة الافتراضية مشتقة من الدور لمسار OIDC فقط.
      permissions: sessionPermissions ?? ROLE_PERMISSIONS[membership.role],
      authorizationVersion: membership.authorizationVersion,
      idleExpiresAt: new Date(now + SESSION_IDLE_MS).toISOString(),
      absoluteExpiresAt: new Date(now + SESSION_ABSOLUTE_MS).toISOString(),
    };
    await this.store.putSession(record);
    return { rawToken, csrfToken, record };
  }

  async authenticate(rawToken: string): Promise<{ principal: Principal; session: SessionRecord } | null> {
    const session = await this.store.findSessionByHash(hashOpaqueToken(rawToken));
    if (session === null || session.revokedAt !== undefined) return null;
    const now = this.now();
    if (Date.parse(session.idleExpiresAt) <= now || Date.parse(session.absoluteExpiresAt) <= now) return null;
    const membership = await this.store.getMembership(session.membershipId, session.tenantId);
    // تحقق التطابق عند المصادقة أيضاً — الجلسة بصف متعارض
    // (identityId ≠ عضويتها) ترفض هنا حتى لو صُدرت قديماً بأخطاء سابقة
    if (membership === null || membership.status !== "active" || membership.tenantId !== session.tenantId ||
        membership.authorizationVersion !== session.authorizationVersion ||
        membership.identityId !== session.identityId) return null;
    return {
      session,
      principal: {
        actorType: "user", authMethod: session.authMethod, subjectId: session.identityId,
        membershipId: session.membershipId, sessionId: session.sessionId,
      tenantId: session.tenantId, permissions: [...session.permissions],
        authorizationVersion: session.authorizationVersion, expiresAt: session.absoluteExpiresAt,
      },
    };
  }

  async revoke(rawToken: string): Promise<boolean> {
    const session = await this.store.findSessionByHash(hashOpaqueToken(rawToken));
    return session === null ? false : this.store.revokeSession(session.sessionId, session.tenantId, new Date(this.now()).toISOString());
  }
}
