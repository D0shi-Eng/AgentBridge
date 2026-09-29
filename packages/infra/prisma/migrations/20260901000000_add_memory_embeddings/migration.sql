-- CreateExtension vector
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable memory_embeddings
CREATE TABLE "memory_embeddings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "chunk" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memory_embeddings_tenant_id_idx" ON "memory_embeddings"("tenant_id");
