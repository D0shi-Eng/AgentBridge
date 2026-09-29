/** محولات سجلات الهوية؛ كل JSON ودور وطريقة مصادقة يُتحقق منها قبل الثقة. */
import { z } from "zod";
import { MembershipRoleSchema, PermissionSchema } from "@agentbridge/shared";
import type { ApiCredentialRecord, ExternalIdentityRecord, LoginTransactionRecord, MembershipRecord, SessionRecord } from "@agentbridge/memory";

const Permissions = z.array(PermissionSchema).max(32);
const AuthMethod = z.enum(["oidc", "api_key_bridge", "local_bootstrap"]);
const Status = z.enum(["active", "disabled"]);

type IdentityRow = { id: string; issuer: string; subject: string; created_at: Date };
type MembershipRow = { id: string; identity_id: string; tenant_id: string; role: string; status: string; authorization_version: number };
type CredentialRow = { id: string; tenant_id: string; subject_id: string; key_hash: string; permissions: unknown; authorization_version: number; revoked_at: Date | null; expires_at: Date | null };
type SessionRow = { id: string; token_hash: string; csrf_hash: string; browser_binding_hash: string; identity_id: string; auth_method: string; membership_id: string; tenant_id: string; permissions: unknown; authorization_version: number; idle_expires_at: Date; absolute_expires_at: Date; revoked_at: Date | null };
type TransactionRow = { id: string; state_hash: string; browser_binding_hash: string; tenant_id: string; config_version: number; config_instance_id: string; nonce: string; verifier_envelope: string; redirect_uri: string; return_path: string; expires_at: Date; consumed_at: Date | null };

export function identityFromRow(row: IdentityRow): ExternalIdentityRecord {
  return { identityId: row.id, issuer: row.issuer, subject: row.subject, createdAt: row.created_at.toISOString() };
}
export function membershipFromRow(row: MembershipRow): MembershipRecord {
  return { membershipId: row.id, identityId: row.identity_id, tenantId: row.tenant_id, role: MembershipRoleSchema.parse(row.role), status: Status.parse(row.status), authorizationVersion: row.authorization_version };
}
export function credentialFromRow(row: CredentialRow): ApiCredentialRecord {
  return { credentialId: row.id, tenantId: row.tenant_id, subjectId: row.subject_id, keyHash: row.key_hash, permissions: Permissions.parse(row.permissions), authorizationVersion: row.authorization_version, ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at.toISOString() }), ...(row.expires_at === null ? {} : { expiresAt: row.expires_at.toISOString() }) };
}
export function sessionFromRow(row: SessionRow): SessionRecord {
  return { sessionId: row.id, tokenHash: row.token_hash, csrfHash: row.csrf_hash, browserBindingHash: row.browser_binding_hash, identityId: row.identity_id, authMethod: AuthMethod.parse(row.auth_method), membershipId: row.membership_id, tenantId: row.tenant_id, permissions: Permissions.parse(row.permissions), authorizationVersion: row.authorization_version, idleExpiresAt: row.idle_expires_at.toISOString(), absoluteExpiresAt: row.absolute_expires_at.toISOString(), ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at.toISOString() }) };
}
export function transactionFromRow(row: TransactionRow): LoginTransactionRecord {
  return { transactionId: row.id, stateHash: row.state_hash, browserBindingHash: row.browser_binding_hash, tenantId: row.tenant_id, configVersion: row.config_version, configInstanceId: row.config_instance_id, nonce: row.nonce, verifierEnvelope: row.verifier_envelope, redirectUri: row.redirect_uri, returnPath: row.return_path, expiresAt: row.expires_at.toISOString(), ...(row.consumed_at === null ? {} : { consumedAt: row.consumed_at.toISOString() }) };
}
