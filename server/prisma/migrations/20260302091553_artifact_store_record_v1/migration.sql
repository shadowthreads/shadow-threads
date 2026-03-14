-- CreateTable
CREATE TABLE "ArtifactStoreRecord" (
    "id" TEXT NOT NULL,
    "schema" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "revisionId" TEXT,
    "revisionHash" TEXT,
    "bundleHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TEXT,

    CONSTRAINT "ArtifactStoreRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactStoreRecord_bundleHash_key" ON "ArtifactStoreRecord"("bundleHash");

-- CreateIndex
CREATE INDEX "ArtifactStoreRecord_packageId_idx" ON "ArtifactStoreRecord"("packageId");

-- CreateIndex
CREATE INDEX "ArtifactStoreRecord_revisionId_idx" ON "ArtifactStoreRecord"("revisionId");

-- CreateIndex
CREATE INDEX "ArtifactStoreRecord_revisionHash_idx" ON "ArtifactStoreRecord"("revisionHash");
