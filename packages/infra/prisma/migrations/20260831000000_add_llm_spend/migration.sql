-- CreateTable
CREATE TABLE "llm_spend" (
    "tenant_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "llm_spend_pkey" PRIMARY KEY ("tenant_id","month")
);
