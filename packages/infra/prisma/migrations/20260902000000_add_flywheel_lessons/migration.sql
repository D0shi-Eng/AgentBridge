-- CreateTable flywheel_lessons
CREATE TABLE "flywheel_lessons" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "spec_pattern" TEXT NOT NULL,
    "design_decision" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "lesson_json" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "flywheel_lessons_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "flywheel_lessons_tenant_id_idx" ON "flywheel_lessons"("tenant_id");
