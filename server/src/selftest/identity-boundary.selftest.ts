import {
  ArtifactHashMismatchError,
  ArtifactStoreService,
  ArtifactValidationError,
} from '../services/artifact-store.service';
import {
  RevisionService,
  RevisionServiceError,
  type RevisionStorageAdapter,
} from '../services/revision.service';
import { computeBundleHash } from '../lib/artifact-hash';

function assertCondition(condition: boolean): void {
  if (!condition) {
    throw new Error('identity_boundary_selftest_failed');
  }
}

async function testBundleHashMismatch(): Promise<void> {
  const service = new ArtifactStoreService();

  let rejected = false;
  try {
    await service.storeArtifactBundle({
      schema: 'artifact.task.state.v1',
      identity: {
        packageId: 'identity-regression',
        revisionHash: null,
        revisionId: null,
      },
      payload: {
        name: 'hash-test',
      },
      bundleHash: '0000000000000000000000000000000000000000000000000000000000000000',
    });
  } catch (error) {
    if (error instanceof ArtifactHashMismatchError && error.code === 'ERR_ARTIFACT_HASH_MISMATCH') {
      rejected = true;
    } else {
      throw error;
    }
  }

  assertCondition(rejected);
}

async function testDangerousKeyRejection(): Promise<void> {
  const service = new ArtifactStoreService();
  const dangerousPayload = Object.create(null) as Record<string, unknown>;
  dangerousPayload.__proto__ = { injected: true };

  let rejected = false;
  try {
    await service.storeArtifactBundle({
      schema: 'artifact.task.state.v1',
      identity: {
        packageId: 'identity-regression',
        revisionHash: null,
        revisionId: null,
      },
      payload: dangerousPayload,
    });
  } catch (error) {
    if (error instanceof ArtifactValidationError) {
      rejected = true;
    } else {
      throw error;
    }
  }

  assertCondition(rejected);
}

function createRevisionStorageAdapter(bundleHash: string): RevisionStorageAdapter {
  const revisions = new Map<
    string,
    {
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
      artifacts: Array<{ bundleHash: string; role: string }>;
    }
  >();

  return {
    async findRevisionByHash(revisionHash) {
      return revisions.get(revisionHash) ?? null;
    },

    async createRevision(input) {
      const stored = {
        revisionHash: input.revisionHash,
        packageId: input.packageId,
        parentRevisionHash: input.parentRevisionHash,
        author: input.metadata.author,
        message: input.metadata.message,
        createdBy: input.metadata.createdBy,
        timestamp: new Date(input.metadata.timestamp),
        source: input.metadata.source,
        metadata: input.metadata,
        createdAt: new Date(input.metadata.timestamp),
        artifacts: input.artifacts.map((artifact) => ({
          bundleHash: artifact.bundleHash,
          role: artifact.role,
        })),
      };
      revisions.set(input.revisionHash, stored);
      return stored;
    },

    async listRevisions(packageId, limit) {
      return Array.from(revisions.values())
        .filter((revision) => revision.packageId === packageId)
        .slice(0, limit);
    },

    async artifactExists(packageId, requestedBundleHash) {
      return packageId === 'identity-package-a' && requestedBundleHash === bundleHash;
    },
  };
}

async function testCrossPackageParent(): Promise<void> {
  const bundleHash = computeBundleHash({
    schema: 'artifact.task.state.v1',
    packageId: 'identity-package-a',
    revisionId: null,
    revisionHash: null,
    payload: {
      name: 'package-a-state',
    },
  });

  const service = new RevisionService(createRevisionStorageAdapter(bundleHash));
  const metadata = {
    author: 'identity-regression',
    message: 'package-a-root',
    createdBy: 'identity-regression',
    timestamp: '2026-03-06T00:00:00.000Z',
    source: 'system' as const,
    tags: ['identity', 'boundary'],
  };

  const root = await service.createRevision({
    packageId: 'identity-package-a',
    parentRevisionHash: null,
    artifacts: [
      {
        bundleHash,
        role: 'primary_state',
      },
    ],
    metadata,
  });

  let rejected = false;
  try {
    await service.createRevision({
      packageId: 'identity-package-b',
      parentRevisionHash: root.revisionHash,
      artifacts: [
        {
          bundleHash,
          role: 'primary_state',
        },
      ],
      metadata: {
        author: 'identity-regression',
        message: 'cross-package-child',
        createdBy: 'identity-regression',
        timestamp: '2026-03-06T00:00:01.000Z',
        source: 'system',
        tags: ['identity', 'boundary'],
      },
    });
  } catch (error) {
    if (error instanceof RevisionServiceError && error.code === 'ERR_REVISION_PARENT_PACKAGE_MISMATCH') {
      rejected = true;
    } else {
      throw error;
    }
  }

  assertCondition(rejected);
}

async function run(): Promise<void> {
  await testBundleHashMismatch();
  await testDangerousKeyRejection();
  await testCrossPackageParent();
  process.stdout.write('IDENTITY_BOUNDARY_SELFTEST_OK\n');
}

if (require.main === module) {
  run().catch((error) => {
    process.stdout.write('IDENTITY_BOUNDARY_SELFTEST_FAIL\n');
    if (error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack}\n`);
    } else {
      process.stderr.write(`${String(error)}\n`);
    }
    process.exit(1);
  });
}

export { run as runIdentityBoundarySelftest };
