-- CreateEnum
CREATE TYPE "TaskPackageStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

-- CreateTable
CREATE TABLE "TaskPackage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceSnapshotId" TEXT,
    "sourceContextId" TEXT,
    "title" TEXT,
    "description" TEXT,
    "status" "TaskPackageStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskPackageRevision" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT 'tpkg-0.1',
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskPackageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskPackage_currentRevisionId_key" ON "TaskPackage"("currentRevisionId");

-- CreateIndex
CREATE INDEX "TaskPackage_userId_createdAt_idx" ON "TaskPackage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskPackage_sourceSnapshotId_idx" ON "TaskPackage"("sourceSnapshotId");

-- CreateIndex
CREATE INDEX "TaskPackage_sourceContextId_idx" ON "TaskPackage"("sourceContextId");

-- CreateIndex
CREATE INDEX "TaskPackageRevision_packageId_createdAt_idx" ON "TaskPackageRevision"("packageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskPackageRevision_packageId_rev_key" ON "TaskPackageRevision"("packageId", "rev");

-- AddForeignKey
ALTER TABLE "TaskPackage" ADD CONSTRAINT "TaskPackage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPackage" ADD CONSTRAINT "TaskPackage_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "StateSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPackage" ADD CONSTRAINT "TaskPackage_sourceContextId_fkey" FOREIGN KEY ("sourceContextId") REFERENCES "SourceContext"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPackage" ADD CONSTRAINT "TaskPackage_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "TaskPackageRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPackageRevision" ADD CONSTRAINT "TaskPackageRevision_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "TaskPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
