/*
  Warnings:

  - You are about to drop the column `label` on the `StateSnapshot` table. All the data in the column will be lost.
  - You are about to drop the column `note` on the `StateSnapshot` table. All the data in the column will be lost.
  - You are about to drop the column `source` on the `StateSnapshot` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[parentId,rev]` on the table `StateSnapshot` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "SourceContext" ADD COLUMN     "contextMessages" JSONB;

-- AlterTable
ALTER TABLE "StateSnapshot" DROP COLUMN "label",
DROP COLUMN "note",
DROP COLUMN "source";

-- DropEnum
DROP TYPE "SnapshotSource";

-- CreateIndex
CREATE UNIQUE INDEX "StateSnapshot_parentId_rev_key" ON "StateSnapshot"("parentId", "rev");
