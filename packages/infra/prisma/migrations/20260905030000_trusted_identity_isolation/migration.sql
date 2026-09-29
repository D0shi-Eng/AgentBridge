-- هوية موثوقة وعزل بنيوي. لا حذف أو تعديل للصفوف التاريخية.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "is_admin" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "sso_configs" (
  "tenant_id" TEXT PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "provider" TEXT NOT NULL, "issuer" TEXT NOT NULL, "client_id" TEXT NOT NULL,
  "jwks_url" TEXT NOT NULL, "authorization_endpoint" TEXT, "token_endpoint" TEXT,
  "scopes" TEXT NOT NULL DEFAULT '["openid"]', "client_secret_envelope" TEXT,
  "config_version" INTEGER NOT NULL DEFAULT 1, "enabled" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "external_identities" (
  "id" TEXT PRIMARY KEY, "issuer" TEXT NOT NULL, "subject" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_identities_issuer_subject_key" UNIQUE ("issuer", "subject")
);
CREATE TABLE "memberships" (
  "id" TEXT PRIMARY KEY, "identity_id" TEXT NOT NULL REFERENCES "external_identities"("id"),
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id"), "role" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active', "authorization_version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "memberships_identity_id_tenant_id_key" UNIQUE ("identity_id", "tenant_id"),
  CONSTRAINT "memberships_tenant_id_id_key" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "memberships_role_check" CHECK ("role" IN ('reader','operator','reviewer','tenant_admin')),
  CONSTRAINT "memberships_status_check" CHECK ("status" IN ('active','disabled'))
);
CREATE INDEX "memberships_tenant_id_status_idx" ON "memberships"("tenant_id", "status");

CREATE TABLE "api_credentials" (
  "id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id"),
  "subject_id" TEXT NOT NULL, "key_hash" TEXT NOT NULL, "permissions" JSONB NOT NULL,
  "authorization_version" INTEGER NOT NULL DEFAULT 1, "revoked_at" TIMESTAMP(3),
  CONSTRAINT "api_credentials_tenant_id_id_key" UNIQUE ("tenant_id", "id")
);
CREATE INDEX "api_credentials_tenant_id_revoked_at_idx" ON "api_credentials"("tenant_id", "revoked_at");

CREATE TABLE "sessions" (
  "id" TEXT PRIMARY KEY, "token_hash" TEXT NOT NULL UNIQUE, "csrf_hash" TEXT NOT NULL,
  "browser_binding_hash" TEXT NOT NULL, "identity_id" TEXT NOT NULL REFERENCES "external_identities"("id"),
  "membership_id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id"),
  "auth_method" TEXT NOT NULL, "permissions" JSONB NOT NULL, "authorization_version" INTEGER NOT NULL,
  "idle_expires_at" TIMESTAMP(3) NOT NULL, "absolute_expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "sessions_tenant_membership_fkey" FOREIGN KEY ("tenant_id", "membership_id")
    REFERENCES "memberships"("tenant_id", "id")
);
CREATE INDEX "sessions_tenant_id_revoked_at_idx" ON "sessions"("tenant_id", "revoked_at");

CREATE TABLE "login_transactions" (
  "id" TEXT PRIMARY KEY, "state_hash" TEXT NOT NULL UNIQUE, "browser_binding_hash" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id"), "config_version" INTEGER NOT NULL,
  "nonce" TEXT NOT NULL, "verifier_envelope" TEXT NOT NULL, "redirect_uri" TEXT NOT NULL,
  "return_path" TEXT NOT NULL, "expires_at" TIMESTAMP(3) NOT NULL, "consumed_at" TIMESTAMP(3)
);
CREATE INDEX "login_transactions_tenant_id_expires_at_idx" ON "login_transactions"("tenant_id", "expires_at");

-- توقف صريح قبل إضافة العلاقات إذا حملت القاعدة بيانات يتيمة.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "projects" p LEFT JOIN "tenants" t ON t.id=p.tenant_id WHERE t.id IS NULL)
    OR EXISTS (SELECT 1 FROM "specs" s LEFT JOIN "projects" p ON p.id=s.project_id AND p.tenant_id=s.tenant_id WHERE p.id IS NULL)
    OR EXISTS (SELECT 1 FROM "pipelines" r LEFT JOIN "projects" p ON p.id=r.project_id AND p.tenant_id=r.tenant_id WHERE p.id IS NULL)
    OR EXISTS (SELECT 1 FROM "pipelines" r LEFT JOIN "specs" s ON s.id=r.spec_id AND s.tenant_id=r.tenant_id WHERE s.id IS NULL)
  THEN RAISE EXCEPTION 'ORPHANED_OR_CROSS_TENANT_ROWS'; END IF;
END $$;

CREATE UNIQUE INDEX "projects_tenant_id_id_key" ON "projects"("tenant_id", "id");
CREATE UNIQUE INDEX "specs_tenant_id_id_key" ON "specs"("tenant_id", "id");
CREATE UNIQUE INDEX "pipelines_tenant_id_id_key" ON "pipelines"("tenant_id", "id");
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
ALTER TABLE "specs" ADD CONSTRAINT "specs_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
ALTER TABLE "specs" ADD CONSTRAINT "specs_tenant_project_fkey" FOREIGN KEY ("tenant_id","project_id") REFERENCES "projects"("tenant_id","id");
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_project_fkey" FOREIGN KEY ("tenant_id","project_id") REFERENCES "projects"("tenant_id","id");
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_spec_fkey" FOREIGN KEY ("tenant_id","spec_id") REFERENCES "specs"("tenant_id","id");
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_tenant_pipeline_fkey" FOREIGN KEY ("tenant_id","run_id") REFERENCES "pipelines"("tenant_id","id");
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_tenant_pipeline_fkey" FOREIGN KEY ("tenant_id","run_id") REFERENCES "pipelines"("tenant_id","id");
CREATE UNIQUE INDEX "certificates_verification_id_key" ON "certificates"("verification_id");

-- يعالج التصادم العالمي دون نقل ملكية صف قائم.
ALTER TABLE "memory_embeddings" DROP CONSTRAINT "memory_embeddings_pkey";
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_pkey" PRIMARY KEY ("tenant_id","run_id","id");
DROP INDEX IF EXISTS "memory_embeddings_tenant_id_idx";
CREATE INDEX "memory_embeddings_tenant_id_run_id_idx" ON "memory_embeddings"("tenant_id","run_id");
ALTER TABLE "flywheel_lessons" DROP CONSTRAINT "flywheel_lessons_pkey";
ALTER TABLE "flywheel_lessons" ADD CONSTRAINT "flywheel_lessons_pkey" PRIMARY KEY ("tenant_id","id");

-- دور التشغيل لا يملك BYPASSRLS؛ فشل إنشاء الدور يمنع هجرة زائفة.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='agentbridge_app') THEN
    CREATE ROLE agentbridge_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

-- سياسة موحدة: SET LOCAL app.tenant_id داخل transaction نفسها؛ الغياب لا يطابق أي صف.
DO $$ DECLARE tab TEXT; tenant_col TEXT; BEGIN
  FOREACH tab IN ARRAY ARRAY['projects','specs','pipelines','certificates','artifacts','llm_spend','memory_embeddings','flywheel_lessons','audit_log','sso_configs','memberships','api_credentials','sessions','login_transactions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tab);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tab);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', tab);
  END LOOP;
END $$;

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenants" USING (id = current_setting('app.tenant_id', true)) WITH CHECK (id = current_setting('app.tenant_id', true));

-- منافذ pre-auth ضيقة: كل سياسة لا ترى إلا صفاً يطابق قيمة lookup محلية داخل transaction.
CREATE POLICY credential_exact_lookup ON "api_credentials" FOR SELECT
  USING (id = current_setting('app.credential_id', true));
CREATE POLICY session_exact_lookup ON "sessions" FOR SELECT
  USING (token_hash = current_setting('app.session_hash', true));
CREATE POLICY transaction_exact_lookup ON "login_transactions" FOR SELECT
  USING (state_hash = current_setting('app.state_hash', true));
CREATE POLICY verification_exact_lookup ON "certificates" FOR SELECT
  USING (verification_id = current_setting('app.verification_id', true));

ALTER TABLE "external_identities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "external_identities" FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_exact_lookup ON "external_identities" FOR SELECT
  USING (issuer = current_setting('app.identity_issuer', true) AND subject = current_setting('app.identity_subject', true));
CREATE POLICY identity_admin_write ON "external_identities" FOR ALL
  USING (current_setting('app.tenant_id', true) <> '')
  WITH CHECK (current_setting('app.tenant_id', true) <> '');

GRANT USAGE ON SCHEMA public TO agentbridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenants","projects","specs","pipelines","certificates","artifacts","llm_spend","memory_embeddings","flywheel_lessons","sso_configs","memberships","api_credentials","sessions","login_transactions" TO agentbridge_app;
GRANT SELECT, INSERT ON "audit_log" TO agentbridge_app;
GRANT SELECT ON "external_identities" TO agentbridge_app;
