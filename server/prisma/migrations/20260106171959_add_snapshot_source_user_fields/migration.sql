-- CreateEnum
CREATE TYPE "SnapshotSource" AS ENUM ('AUTO', 'USER');

-- AlterTable
ALTER TABLE "StateSnapshot" ADD COLUMN     "label" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "source" "SnapshotSource" NOT NULL DEFAULT 'AUTO';
