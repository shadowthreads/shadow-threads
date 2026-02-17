import { Prisma, PrismaClient } from '@prisma/client';
import { computeRevisionHash } from '../../src/services/task-package.hash';

const prisma = new PrismaClient();
const BATCH_SIZE = 200;

type BackfillRow = {
  id: string;
  packageId: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
};

function isRevisionHashUniqueConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;

  if (err.code === 'P2002') {
    const target = err.meta?.target;
    if (Array.isArray(target)) {
      const parts = target.map((item) => String(item));
      return parts.includes('packageId') && parts.includes('revisionHash');
    }
    if (typeof target === 'string') {
      return target.includes('packageId') && target.includes('revisionHash');
    }
  }

  // Unique conflict from raw SQL on Postgres.
  if (err.code === 'P2010') {
    const meta = err.meta as { code?: string; message?: string } | undefined;
    return (
      meta?.code === '23505' &&
      typeof meta.message === 'string' &&
      meta.message.includes('TaskPackageRevision_packageId_revisionHash_key')
    );
  }

  return false;
}

function buildScanQuery(cursorCreatedAt: Date | null, cursorId: string | null) {
  if (!cursorCreatedAt || !cursorId) {
    return Prisma.sql`
      SELECT id, "packageId", payload, "createdAt"
      FROM "TaskPackageRevision"
      WHERE "revisionHash" IS NULL
      ORDER BY "createdAt" ASC, id ASC
      LIMIT ${BATCH_SIZE}
    `;
  }

  return Prisma.sql`
    SELECT id, "packageId", payload, "createdAt"
    FROM "TaskPackageRevision"
    WHERE "revisionHash" IS NULL
      AND ("createdAt" > ${cursorCreatedAt} OR ("createdAt" = ${cursorCreatedAt} AND id > ${cursorId}))
    ORDER BY "createdAt" ASC, id ASC
    LIMIT ${BATCH_SIZE}
  `;
}

async function updateRevisionHash(id: string, revisionHash: string): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "TaskPackageRevision"
    SET "revisionHash" = ${revisionHash}
    WHERE id = ${id}
      AND "revisionHash" IS NULL
  `;
}

async function main() {
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let conflicts = 0;
  let cursorCreatedAt: Date | null = null;
  let cursorId: string | null = null;

  // Cursor scan over NULL rows; safe to rerun from start.
  while (true) {
    const rows = await prisma.$queryRaw<BackfillRow[]>(buildScanQuery(cursorCreatedAt, cursorId));
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const revisionHash = computeRevisionHash(row.payload);

      try {
        const affected = await updateRevisionHash(row.id, revisionHash);
        if (affected === 1) {
          updated += 1;
        } else {
          skipped += 1;
        }
      } catch (err: unknown) {
        if (isRevisionHashUniqueConflict(err)) {
          conflicts += 1;
        } else {
          throw err;
        }
      }

      cursorCreatedAt = row.createdAt;
      cursorId = row.id;
    }
  }

  console.log(
    JSON.stringify(
      {
        scanned,
        updated,
        skipped,
        conflicts,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
