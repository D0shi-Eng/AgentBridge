/**
 * منفذ الهوية والجلسة — عقود نطاق بلا اعتماد على Prisma أو cookies.
 * البحث قبل المصادقة ضيق إلى hash جلسة أو معرف اعتماد أو issuer+subject.
 */
import type { MembershipRole, Permission } from "@agentbridge/shared";

export interface ExternalIdentityRecord {
  readonly identityId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly createdAt: string;
}

export interface MembershipRecord {
  readonly membershipId: string;
  readonly identityId: string;
  readonly tenantId: string;
  readonly role: MembershipRole;
  readonly status: "active" | "disabled";
  readonly authorizationVersion: number;
}

export interface ApiCredentialRecord {
  readonly credentialId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly keyHash: string;
  readonly permissions: readonly Permission[];
  readonly authorizationVersion: number;
  readonly revokedAt?: string;
  /**
   * FC — الإقفال النهائي: صلاحية اختيارية بتوقيت ISO. اعتماد منقضٍ يفشل
   * المصادقة fail-closed حتى لو لم يُلغَ؛ سياسة الدوران عبر الإصدار
   * الجديد ثم إلغاء القديم (لا تمديد صامت للصلاحية).
   */
  readonly expiresAt?: string;
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly tokenHash: string;
  readonly csrfHash: string;
  readonly browserBindingHash: string;
  readonly identityId: string;
  readonly authMethod: "oidc" | "api_key_bridge" | "local_bootstrap";
  readonly membershipId: string;
  readonly tenantId: string;
  readonly permissions: readonly Permission[];
  readonly authorizationVersion: number;
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
  readonly revokedAt?: string;
}

export interface LoginTransactionRecord {
  readonly transactionId: string;
  readonly stateHash: string;
  readonly browserBindingHash: string;
  readonly tenantId: string;
  readonly configVersion: number;
  /** هوية دورة إعداد SSO — إعادة الإنشاء تولّد جديداً فيكسر ABA */
  readonly configInstanceId: string;
  readonly nonce: string;
  readonly verifierEnvelope: string;
  readonly redirectUri: string;
  readonly returnPath: string;
  readonly expiresAt: string;
  readonly consumedAt?: string;
}

/**
 * عضوية داخلية مشتقة من اعتماد API: غير قابلة للإلغاء اليدوي،
 * ومصداقها موثق بالنسخة، ومعرفها الاعتماد نفسه — فإلغاء الاعتماد يلغيها
 * وجلساتها المشتقة ذرياً في المحولين (الحive والداخلي) بنفس الدلالات.
 */
export interface InternalMembershipRecord extends MembershipRecord {
  readonly credentialId: string;
  readonly internalVersion: string;
  readonly revocable: false;
}

/** معرف العضوية الداخلية المشتقة من اعتماد — حتمي لإلغائها لاحقاً */
export function internalMembershipId(credentialId: string): string {
  return `internal-member:${credentialId}`;
}

/** معرف الهوية الداخلية المشتقة من اعتماد */
export function internalIdentityId(credentialId: string): string {
  return `internal:${credentialId}`;
}

export interface AuthStore {
  putExternalIdentity(record: ExternalIdentityRecord): Promise<void>;
  findExternalIdentity(issuer: string, subject: string): Promise<ExternalIdentityRecord | null>;
  putMembership(record: MembershipRecord): Promise<void>;
  getMembership(membershipId: string, tenantId: string): Promise<MembershipRecord | null>;
  findMembership(identityId: string, tenantId: string): Promise<MembershipRecord | null>;
  putApiCredential(record: ApiCredentialRecord): Promise<void>;
  findApiCredential(credentialId: string): Promise<ApiCredentialRecord | null>;
  findLegacyCredential(tenantId: string): Promise<ApiCredentialRecord | null>;
  putSession(record: SessionRecord): Promise<void>;
  findSessionByHash(tokenHash: string): Promise<SessionRecord | null>;
  revokeSession(sessionId: string, tenantId: string, revokedAt: string): Promise<boolean>;
  rotateSession(expectedId: string, next: SessionRecord): Promise<boolean>;
  putLoginTransaction(record: LoginTransactionRecord): Promise<void>;
  consumeLoginTransaction(stateHash: string, consumedAt: string): Promise<LoginTransactionRecord | null>;
}
