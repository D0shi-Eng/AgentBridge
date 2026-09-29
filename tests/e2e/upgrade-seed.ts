/**
 * بذر بيانات ما قبل هجرة SSO على قاعدة عند الهجرات التاريخية الخمس:
 * tenant · SSO config · login transaction (بلا عمود الهوية — لم يوجد بعد) ·
 * membership · session · project/spec/pipeline. كل الإدراجات بمالك الجداول.
 */
import type { PrismaClient } from "@prisma/client";

export interface SeedResult {
  readonly tenantId: string;
  readonly loginTxStateHash: string;
  readonly loginTxId: string;
  readonly configInstanceId: string;
}

/** يبذر سلسلة بيانات كاملة مترابطة ويعيد المعرفات الحاسمة للتحقق بعد الترقية */
export async function seedPreSsoData(owner: PrismaClient, tag: string): Promise<SeedResult> {
  const tenantId = `t-${tag}`;
  await owner.$executeRawUnsafe(
    `INSERT INTO "tenants" ("id","name","api_key_hash","is_admin","created_at") VALUES ($1,$2,'seed',false,NOW())`, tenantId, `مستأجر ${tag}`);
  await owner.$executeRawUnsafe(
    `INSERT INTO "projects" ("id","tenant_id","name","created_at") VALUES ($1,$2,'مشروع',NOW())`, `p-${tag}`, tenantId);
  await owner.$executeRawUnsafe(
    `INSERT INTO "specs" ("id","tenant_id","project_id","content","created_at") VALUES ($1,$2,$3,'{}',NOW())`,
    `s-${tag}`, tenantId, `p-${tag}`);
  await owner.$executeRawUnsafe(
    `INSERT INTO "pipelines" ("id","tenant_id","project_id","spec_id","status","repair_cycles_used","created_at","updated_at")
     VALUES ($1,$2,$3,$4,'completed',0,NOW(),NOW())`, `r-${tag}`, tenantId, `p-${tag}`, `s-${tag}`);
  // SSO config عند مستوى ما قبل هجرة SSO: بلا عمود config_instance_id (تضيفه هجرة SSO)
  await owner.$executeRawUnsafe(
    `INSERT INTO "sso_configs" ("tenant_id","provider","issuer","client_id","jwks_url","scopes","config_version","enabled","created_at","updated_at")
     VALUES ($1,'oidc','https://issuer.example.com','client','https://issuer.example.com/jwks','["openid"]',1,true,NOW(),NOW())`, tenantId);
  // هوية + عضوية + جلسة
  await owner.$executeRawUnsafe(
    `INSERT INTO "external_identities" ("id","issuer","subject","created_at") VALUES ($1,'urn:test',$2,NOW())`,
    `i-${tag}`, `user-${tag}`);
  await owner.$executeRawUnsafe(
    `INSERT INTO "memberships" ("id","identity_id","tenant_id","role","status","authorization_version")
     VALUES ($1,$2,$3,'reader','active',1)`, `m-${tag}`, `i-${tag}`, tenantId);
  await owner.$executeRawUnsafe(
    `INSERT INTO "sessions" ("id","token_hash","csrf_hash","browser_binding_hash","identity_id","membership_id","tenant_id",
       "auth_method","permissions","authorization_version","idle_expires_at","absolute_expires_at","revoked_at")
     VALUES ($1,$2,$3,$4,$5,$6,$7,'oidc','[]',1,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '1 day',NULL)`,
    `sess-${tag}`, `th-${tag}`, `bh-${tag}`, `cbh-${tag}`, `i-${tag}`, `m-${tag}`, tenantId);
  // معاملة دخول قديمة: بلا config_instance_id (هجرة SSO تضيفه لاحقاً بقيمة NULL)
  const stateHash = `state-${tag}`;
  await owner.$executeRawUnsafe(
    `INSERT INTO "login_transactions" ("id","state_hash","browser_binding_hash","tenant_id","config_version","nonce",
       "verifier_envelope","redirect_uri","return_path","expires_at","consumed_at")
     VALUES ($1,$2,$3,$4,1,$5,'env','http://127.0.0.1:3000/auth/oidc/callback','/app',NOW()+INTERVAL '1 hour',NULL)`,
    `tx-${tag}`, stateHash, `bh-${tag}`, tenantId, `nonce-${tag}`);
  return { tenantId, loginTxStateHash: stateHash, loginTxId: `tx-${tag}`, configInstanceId: "" };
}
