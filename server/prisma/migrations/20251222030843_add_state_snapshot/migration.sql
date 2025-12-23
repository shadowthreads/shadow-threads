-- CreateTable
CREATE TABLE "StateSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subthreadId" TEXT,
    "snapshot" JSONB NOT NULL,
    "version" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StateSnapshot_userId_createdAt_idx" ON "StateSnapshot"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "StateSnapshot_subthreadId_idx" ON "StateSnapshot"("subthreadId");

-- AddForeignKey
ALTER TABLE "StateSnapshot" ADD CONSTRAINT "StateSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateSnapshot" ADD CONSTRAINT "StateSnapshot_subthreadId_fkey" FOREIGN KEY ("subthreadId") REFERENCES "Subthread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
