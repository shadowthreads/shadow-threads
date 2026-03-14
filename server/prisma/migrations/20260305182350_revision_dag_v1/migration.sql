-- CreateTable
CREATE TABLE "revision_nodes" (
    "revisionHash" CHAR(64) NOT NULL,
    "packageId" TEXT NOT NULL,
    "parentRevisionHash" CHAR(64),
    "author" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revision_nodes_pkey" PRIMARY KEY ("revisionHash")
);

-- CreateTable
CREATE TABLE "revision_artifacts" (
    "revisionHash" CHAR(64) NOT NULL,
    "bundleHash" CHAR(64) NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "revision_artifacts_pkey" PRIMARY KEY ("revisionHash","bundleHash")
);

-- CreateIndex
CREATE INDEX "revision_nodes_packageId_idx" ON "revision_nodes"("packageId");

-- CreateIndex
CREATE INDEX "revision_nodes_parentRevisionHash_idx" ON "revision_nodes"("parentRevisionHash");

-- CreateIndex
CREATE INDEX "revision_artifacts_bundleHash_idx" ON "revision_artifacts"("bundleHash");

-- AddForeignKey
ALTER TABLE "revision_nodes" ADD CONSTRAINT "revision_nodes_parentRevisionHash_fkey" FOREIGN KEY ("parentRevisionHash") REFERENCES "revision_nodes"("revisionHash") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_artifacts" ADD CONSTRAINT "revision_artifacts_revisionHash_fkey" FOREIGN KEY ("revisionHash") REFERENCES "revision_nodes"("revisionHash") ON DELETE CASCADE ON UPDATE CASCADE;
