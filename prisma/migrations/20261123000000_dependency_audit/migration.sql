-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_ALERT';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "repository" TEXT;

-- CreateTable
CREATE TABLE "ProjectAudit" (
    "projectId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "critical" INTEGER NOT NULL DEFAULT 0,
    "high" INTEGER NOT NULL DEFAULT 0,
    "moderate" INTEGER NOT NULL DEFAULT 0,
    "low" INTEGER NOT NULL DEFAULT 0,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "checkedAt" TIMESTAMPTZ(3),
    "attemptedAt" TIMESTAMPTZ(3) NOT NULL,
    "error" TEXT,

    CONSTRAINT "ProjectAudit_pkey" PRIMARY KEY ("projectId")
);

-- CreateIndex
CREATE INDEX "ProjectAudit_attemptedAt_idx" ON "ProjectAudit"("attemptedAt");

-- AddForeignKey
ALTER TABLE "ProjectAudit" ADD CONSTRAINT "ProjectAudit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
