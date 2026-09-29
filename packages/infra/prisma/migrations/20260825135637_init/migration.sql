-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "specs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "spec_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stopped_at" TEXT,
    "repair_cycles_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "run_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "final_score" INTEGER NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "verification_id" TEXT NOT NULL,
    "certificate_json" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("tenant_id","run_id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "run_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "artifact_json" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("tenant_id","run_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "seq" INTEGER NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "abstracted_payload" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE INDEX "projects_tenant_id_idx" ON "projects"("tenant_id");

-- CreateIndex
CREATE INDEX "specs_tenant_id_project_id_idx" ON "specs"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "pipelines_tenant_id_status_idx" ON "pipelines"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "certificates_verification_id_idx" ON "certificates"("verification_id");

-- CreateIndex
CREATE INDEX "artifacts_tenant_id_idx" ON "artifacts"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_run_id_idx" ON "audit_log"("tenant_id", "run_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_tenant_id_seq_key" ON "audit_log"("tenant_id", "seq");
