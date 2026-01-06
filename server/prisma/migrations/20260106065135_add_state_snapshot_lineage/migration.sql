-- AlterTable
ALTER TABLE "StateSnapshot" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "rev" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rootId" TEXT;

-- CreateIndex
CREATE INDEX "StateSnapshot_rootId_idx" ON "StateSnapshot"("rootId");

-- CreateIndex
CREATE INDEX "StateSnapshot_parentId_idx" ON "StateSnapshot"("parentId");

-- AddForeignKey
ALTER TABLE "StateSnapshot" ADD CONSTRAINT "StateSnapshot_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "StateSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
