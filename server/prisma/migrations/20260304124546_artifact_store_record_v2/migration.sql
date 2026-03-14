/*
  Warnings:

  - You are about to alter the column `bundleHash` on the `ArtifactStoreRecord` table.
  - The `createdAt` column on the `ArtifactStoreRecord` table will be converted to TIMESTAMPTZ(6) without dropping existing values.
  - A unique constraint covering the columns `[packageId,bundleHash]` on the table `ArtifactStoreRecord` will be added. If there are existing duplicate values, this will fail.
*/

-- Drop the old unique index on bundleHash (v1)
DROP INDEX "ArtifactStoreRecord_bundleHash_key";

-- 1) bundleHash: TEXT -> VARCHAR(64) (no padding semantics)
ALTER TABLE "ArtifactStoreRecord"
  ALTER COLUMN "bundleHash" TYPE VARCHAR(64);

-- Enforce exact length = 64 (sha-256 hex)
ALTER TABLE "ArtifactStoreRecord"
  ADD CONSTRAINT "ArtifactStoreRecord_bundleHash_len_64_chk"
  CHECK (length("bundleHash") = 64);

-- 2) createdAt: production-safe conversion (no DROP+ADD)
-- Assume old createdAt was TEXT (possibly NULL / possibly non-parseable).
-- Strategy: add new column -> backfill -> swap.

ALTER TABLE "ArtifactStoreRecord"
  ADD COLUMN "createdAt_new" TIMESTAMPTZ(6);

-- Backfill:
-- If createdAt is a parseable timestamp string, cast it.
-- If it's NULL/empty/unparseable, fall back to CURRENT_TIMESTAMP.
--
-- Note: regex check reduces cast errors; it's not perfect but avoids obvious failures.
UPDATE "ArtifactStoreRecord"
SET "createdAt_new" =
  CASE
    WHEN "createdAt" IS NULL OR trim("createdAt") = '' THEN CURRENT_TIMESTAMP
    WHEN "createdAt" ~ '^\d{4}-\d{2}-\d{2}' THEN ("createdAt"::timestamptz)
    ELSE CURRENT_TIMESTAMP
  END;

-- Swap columns
ALTER TABLE "ArtifactStoreRecord"
  DROP COLUMN "createdAt";

ALTER TABLE "ArtifactStoreRecord"
  RENAME COLUMN "createdAt_new" TO "createdAt";

-- Enforce NOT NULL + DEFAULT
ALTER TABLE "ArtifactStoreRecord"
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ArtifactStoreRecord"
  ALTER COLUMN "createdAt" SET NOT NULL;

-- 3) New unique constraint: (packageId, bundleHash)
CREATE UNIQUE INDEX "ArtifactStoreRecord_packageId_bundleHash_key"
ON "ArtifactStoreRecord"("packageId", "bundleHash");