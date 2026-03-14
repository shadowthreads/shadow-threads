import type { RevisionArtifactReference, RevisionMetadata } from '../lib/revision-hash';
import {
  RevisionService,
  type RevisionStorageAdapter,
  type RevisionRecord,
  RevisionServiceError,
  REVISION_ERROR_CODES,
} from '../services/revision.service';

const SELFTEST_PACKAGE_ID = 'revision-selftest-package';

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function assertCondition(condition: boolean): void {
  if (!condition) {
    throw new Error('revision_selftest_failed');
  }
}

type StoredRevisionRecord = {
  revisionHash: string;
  packageId: string;
  parentRevisionHash: string | null;
  author: string;
  message: string;
  createdBy: string;
  timestamp: Date;
  source: string;
  metadata: unknown;
  createdAt: Date;
  artifacts: RevisionArtifactReference[];
};

function createInMemoryAdapter(): {
  adapter: RevisionStorageAdapter;
  artifacts: Set<string>;
} {
  const revisions = new Map<string, StoredRevisionRecord>();
  const artifacts = new Set<string>();

  const adapter: RevisionStorageAdapter = {
    async findRevisionByHash(revisionHash: string): Promise<StoredRevisionRecord | null> {
      return revisions.get(revisionHash) ?? null;
    },

    async createRevision(input: {
      revisionHash: string;
      packageId: string;
      parentRevisionHash: string | null;
      metadata: RevisionMetadata;
      artifacts: RevisionArtifactReference[];
    }): Promise<StoredRevisionRecord> {
      const createdAt = new Date(Date.parse('2026-03-05T00:00:00.000Z') + revisions.size * 1000);
      const node: StoredRevisionRecord = {
        revisionHash: input.revisionHash,
        packageId: input.packageId,
        parentRevisionHash: input.parentRevisionHash,
        author: input.metadata.author,
        message: input.metadata.message,
        createdBy: input.metadata.createdBy,
        timestamp: new Date(input.metadata.timestamp),
        source: input.metadata.source,
        metadata: input.metadata,
        createdAt,
        artifacts: input.artifacts.map((artifact) => ({
          bundleHash: artifact.bundleHash,
          role: artifact.role,
        })),
      };

      revisions.set(node.revisionHash, node);
      return node;
    },

    async listRevisions(packageId: string, limit: number): Promise<StoredRevisionRecord[]> {
      const rows: StoredRevisionRecord[] = [];
      for (const revision of revisions.values()) {
        if (revision.packageId === packageId) {
          rows.push(revision);
        }
      }

      rows.sort((a, b) => {
        const tsDiff = a.timestamp.getTime() - b.timestamp.getTime();
        if (tsDiff !== 0) {
          return tsDiff < 0 ? -1 : 1;
        }
        return compareStrings(a.revisionHash, b.revisionHash);
      });

      return rows.slice(0, limit);
    },

    async artifactExists(packageId: string, bundleHash: string): Promise<boolean> {
      return artifacts.has(`${packageId}:${bundleHash}`);
    },
  };

  return { adapter, artifacts };
}

function addArtifactReference(artifacts: Set<string>, packageId: string, bundleHash: string): void {
  artifacts.add(`${packageId}:${bundleHash}`);
}

async function runRevisionSelftest(): Promise<void> {
  const memory = createInMemoryAdapter();
  const revisionService = new RevisionService(memory.adapter);

  const firstBundleHash = '1111111111111111111111111111111111111111111111111111111111111111';
  const secondBundleHash = '2222222222222222222222222222222222222222222222222222222222222222';

  addArtifactReference(memory.artifacts, SELFTEST_PACKAGE_ID, firstBundleHash);
  addArtifactReference(memory.artifacts, SELFTEST_PACKAGE_ID, secondBundleHash);

  const firstRevision = await revisionService.createRevision({
    packageId: SELFTEST_PACKAGE_ID,
    artifacts: [
      { bundleHash: secondBundleHash, role: 'output' },
      { bundleHash: firstBundleHash, role: 'input' },
    ],
    metadata: {
      author: 'selftest-author',
      message: 'first revision',
      createdBy: 'selftest',
      timestamp: '2026-03-05T00:00:00.000Z',
      source: 'system',
      tags: ['milestone-c', 'selftest'],
    },
  });

  const firstRevisionAgain = await revisionService.createRevision({
    packageId: SELFTEST_PACKAGE_ID,
    artifacts: [
      { bundleHash: firstBundleHash, role: 'input' },
      { bundleHash: secondBundleHash, role: 'output' },
    ],
    metadata: {
      author: 'selftest-author',
      message: 'first revision',
      createdBy: 'selftest',
      timestamp: '2026-03-05T00:00:00.000Z',
      source: 'system',
      tags: ['selftest', 'milestone-c'],
    },
  });

  assertCondition(firstRevision.revisionHash === firstRevisionAgain.revisionHash);

  let parentValidationCaught = false;
  try {
    await revisionService.createRevision({
      packageId: SELFTEST_PACKAGE_ID,
      parentRevisionHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      artifacts: [{ bundleHash: firstBundleHash, role: 'input' }],
      metadata: {
        author: 'selftest-author',
        message: 'invalid parent',
        createdBy: 'selftest',
        timestamp: '2026-03-05T00:00:01.000Z',
        source: 'system',
      },
    });
  } catch (error) {
    if (
      error instanceof RevisionServiceError &&
      error.code === REVISION_ERROR_CODES.ERR_REVISION_PARENT_NOT_FOUND
    ) {
      parentValidationCaught = true;
    } else {
      throw error;
    }
  }

  assertCondition(parentValidationCaught);

  let artifactValidationCaught = false;
  try {
    await revisionService.createRevision({
      packageId: SELFTEST_PACKAGE_ID,
      artifacts: [{ bundleHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', role: 'input' }],
      metadata: {
        author: 'selftest-author',
        message: 'missing artifact',
        createdBy: 'selftest',
        timestamp: '2026-03-05T00:00:02.000Z',
        source: 'system',
      },
    });
  } catch (error) {
    if (
      error instanceof RevisionServiceError &&
      error.code === REVISION_ERROR_CODES.ERR_ARTIFACT_NOT_FOUND
    ) {
      artifactValidationCaught = true;
    } else {
      throw error;
    }
  }

  assertCondition(artifactValidationCaught);

  const secondRevision = await revisionService.createRevision({
    packageId: SELFTEST_PACKAGE_ID,
    parentRevisionHash: firstRevision.revisionHash,
    artifacts: [{ bundleHash: firstBundleHash, role: 'input' }],
    metadata: {
      author: 'selftest-author',
      message: 'second revision',
      createdBy: 'selftest',
      timestamp: '2026-03-05T00:00:03.000Z',
      source: 'system',
    },
  });

  const loaded = await revisionService.getRevision({ revisionHash: secondRevision.revisionHash });
  assertCondition(loaded !== null);
  assertCondition((loaded as RevisionRecord).parentRevisionHash === firstRevision.revisionHash);

  const listed = await revisionService.listRevisions({ packageId: SELFTEST_PACKAGE_ID, limit: 10 });
  assertCondition(listed.length >= 2);
  assertCondition(listed[0].revisionHash === firstRevision.revisionHash);
  assertCondition(listed[1].revisionHash === secondRevision.revisionHash);
}

if (require.main === module) {
  runRevisionSelftest()
    .then(() => {
      process.stdout.write('REVISION_SELFTEST_OK\n');
    })
    .catch(() => {
      process.stdout.write('REVISION_SELFTEST_FAIL\n');
      process.exit(1);
    });
}
