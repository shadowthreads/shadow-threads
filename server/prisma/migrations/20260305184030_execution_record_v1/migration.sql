-- CreateTable
CREATE TABLE "execution_records" (
    "executionId" UUID NOT NULL,
    "packageId" TEXT NOT NULL,
    "revisionHash" CHAR(64) NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptHash" CHAR(64) NOT NULL,
    "parameters" JSONB NOT NULL,
    "resultHash" CHAR(64) NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL,
    "finishedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_records_pkey" PRIMARY KEY ("executionId")
);

-- CreateTable
CREATE TABLE "execution_inputs" (
    "executionId" UUID NOT NULL,
    "bundleHash" CHAR(64) NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "execution_inputs_pkey" PRIMARY KEY ("executionId","bundleHash")
);

-- CreateTable
CREATE TABLE "execution_outputs" (
    "executionId" UUID NOT NULL,
    "bundleHash" CHAR(64) NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "execution_outputs_pkey" PRIMARY KEY ("executionId","bundleHash")
);

-- CreateIndex
CREATE INDEX "execution_records_packageId_idx" ON "execution_records"("packageId");

-- CreateIndex
CREATE INDEX "execution_records_revisionHash_idx" ON "execution_records"("revisionHash");

-- CreateIndex
CREATE INDEX "execution_records_promptHash_idx" ON "execution_records"("promptHash");

-- CreateIndex
CREATE INDEX "execution_records_status_idx" ON "execution_records"("status");

-- CreateIndex
CREATE INDEX "execution_inputs_bundleHash_idx" ON "execution_inputs"("bundleHash");

-- CreateIndex
CREATE INDEX "execution_outputs_bundleHash_idx" ON "execution_outputs"("bundleHash");

-- AddForeignKey
ALTER TABLE "execution_records" ADD CONSTRAINT "execution_records_revisionHash_fkey" FOREIGN KEY ("revisionHash") REFERENCES "revision_nodes"("revisionHash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_inputs" ADD CONSTRAINT "execution_inputs_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "execution_records"("executionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_outputs" ADD CONSTRAINT "execution_outputs_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "execution_records"("executionId") ON DELETE CASCADE ON UPDATE CASCADE;
