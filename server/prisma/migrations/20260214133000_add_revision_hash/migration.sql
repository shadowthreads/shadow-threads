ALTER TABLE "TaskPackageRevision" ADD COLUMN "revisionHash" TEXT;

CREATE INDEX "TaskPackageRevision_revisionHash_idx"
ON "TaskPackageRevision"("revisionHash");

CREATE UNIQUE INDEX "TaskPackageRevision_packageId_revisionHash_key"
ON "TaskPackageRevision"("packageId","revisionHash");
