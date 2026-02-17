-- Fail loudly if NULL revisionHash rows still exist (division by zero).
SELECT 1 / CASE
  WHEN EXISTS (SELECT 1 FROM "TaskPackageRevision" WHERE "revisionHash" IS NULL) THEN 0
  ELSE 1
END;

ALTER TABLE "TaskPackageRevision"
ALTER COLUMN "revisionHash" SET NOT NULL;
