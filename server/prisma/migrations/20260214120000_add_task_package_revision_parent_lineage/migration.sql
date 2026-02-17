-- AlterTable
ALTER TABLE "TaskPackageRevision" ADD COLUMN "parentRevisionId" TEXT;

-- CreateIndex
CREATE INDEX "TaskPackageRevision_parentRevisionId_idx" ON "TaskPackageRevision"("parentRevisionId");

-- AddForeignKey
ALTER TABLE "TaskPackageRevision" ADD CONSTRAINT "TaskPackageRevision_parentRevisionId_fkey" FOREIGN KEY ("parentRevisionId") REFERENCES "TaskPackageRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
