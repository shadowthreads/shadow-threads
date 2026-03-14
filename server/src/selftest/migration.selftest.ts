import { existsSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';
import { canonicalizeJson, computeBundleHash } from '../lib/artifact-hash';
import { computeRevisionHash, type RevisionArtifactReference, type RevisionMetadata } from '../lib/revision-hash';
import { readMigrationPackageZip, parseArtifactsJsonl, type ArtifactBundleLike } from '../lib/migration-package';
import { MigrationService } from '../services/migration.service';

type StoredRevision = {
  revisionHash: string;
  packageId: string;
  parentRevisionHash: string | null;
  artifacts: RevisionArtifactReference[];
  metadata: RevisionMetadata;
};

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function assertCondition(condition: boolean): void {
  if (!condition) {
    throw new Error('migration_selftest_failed');
  }
}

function normalizeBundle(bundle: ArtifactBundleLike): ArtifactBundleLike {
  return {
    schema: bundle.schema,
    identity: {
      packageId: bundle.identity.packageId,
      revisionId: bundle.identity.revisionId ?? null,
      revisionHash: bundle.identity.revisionHash ?? null,
    },
    payload: bundle.payload,
    references: Array.isArray(bundle.references)
      ? [...bundle.references].sort((a, b) => compareStrings(a.bundleHash, b.bundleHash) || compareStrings(a.role, b.role))
      : [],
  };
}

function hashBundle(bundle: ArtifactBundleLike): string {
  const normalized = normalizeBundle(bundle);
  return computeBundleHash({
    schema: normalized.schema,
    packageId: normalized.identity.packageId,
    revisionId: normalized.identity.revisionId ?? null,
    revisionHash: normalized.identity.revisionHash ?? null,
    payload: normalized,
  });
}

function cloneBundle(bundle: ArtifactBundleLike): ArtifactBundleLike {
  return JSON.parse(canonicalizeJson(normalizeBundle(bundle))) as ArtifactBundleLike;
}

function createInMemoryAdapter() {
  const artifactsByHash = new Map<string, ArtifactBundleLike>();
  const artifactsByPackageAndHash = new Map<string, ArtifactBundleLike>();
  const revisionsByHash = new Map<string, StoredRevision>();

  return {
    adapter: {
      async findRevisionByHash(revisionHash: string): Promise<StoredRevision | null> {
        return revisionsByHash.get(revisionHash) ?? null;
      },

      async findArtifactByPackageAndHash(packageId: string, bundleHash: string): Promise<ArtifactBundleLike | null> {
        return artifactsByPackageAndHash.get(`${packageId}:${bundleHash}`) ?? null;
      },

      async findArtifactByHash(bundleHash: string): Promise<ArtifactBundleLike | null> {
        return artifactsByHash.get(bundleHash) ?? null;
      },

      async storeArtifactBundle(bundle: ArtifactBundleLike): Promise<void> {
        const normalized = cloneBundle(bundle);
        const bundleHash = hashBundle(normalized);
        const existing = artifactsByHash.get(bundleHash);
        if (existing && canonicalizeJson(existing) !== canonicalizeJson(normalized)) {
          throw new Error('migration_selftest_failed');
        }
        artifactsByHash.set(bundleHash, normalized);
        artifactsByPackageAndHash.set(`${normalized.identity.packageId}:${bundleHash}`, normalized);
      },

      async createRevision(revision: StoredRevision): Promise<{ revisionHash: string }> {
        for (const artifact of revision.artifacts) {
          if (!artifactsByPackageAndHash.has(`${revision.packageId}:${artifact.bundleHash}`)) {
            throw new Error('migration_selftest_failed');
          }
        }
        const recomputed = computeRevisionHash({
          packageId: revision.packageId,
          parentRevisionHash: revision.parentRevisionHash,
          artifacts: revision.artifacts,
          metadata: revision.metadata,
        });
        if (recomputed !== revision.revisionHash) {
          throw new Error('migration_selftest_failed');
        }
        if (!revisionsByHash.has(revision.revisionHash)) {
          revisionsByHash.set(revision.revisionHash, {
            revisionHash: revision.revisionHash,
            packageId: revision.packageId,
            parentRevisionHash: revision.parentRevisionHash,
            artifacts: revision.artifacts.map((artifact) => ({ bundleHash: artifact.bundleHash, role: artifact.role })),
            metadata: {
              author: revision.metadata.author,
              message: revision.metadata.message,
              createdBy: revision.metadata.createdBy,
              timestamp: revision.metadata.timestamp,
              source: revision.metadata.source,
              tags: [...(revision.metadata.tags ?? [])],
            },
          });
        }
        return { revisionHash: revision.revisionHash };
      },
    },
    artifactsByHash,
    revisionsByHash,
  };
}

async function runMigrationSelftest(): Promise<{ zipPath: string }> {
  const packageId = 'migration-selftest-package';
  const genesisTimestamp = '2026-03-05T00:00:00.000Z';
  const rootTimestamp = '2026-03-06T00:00:00.000Z';

  const baseArtifact: ArtifactBundleLike = {
    schema: 'artifact.task.state.v1',
    identity: { packageId, revisionId: null, revisionHash: null },
    payload: {
      name: 'base-artifact',
      state: 'ready',
    },
    references: [],
  };

  const derivedArtifact: ArtifactBundleLike = {
    schema: 'artifact.execution.record.v1',
    identity: { packageId, revisionId: null, revisionHash: null },
    payload: {
      name: 'derived-artifact',
      result: 'ok',
    },
    references: [{ bundleHash: hashBundle(baseArtifact), role: 'depends_on' }],
  };

  const baseBundleHash = hashBundle(baseArtifact);
  const derivedBundleHash = hashBundle(derivedArtifact);

  const genesisRevision: StoredRevision = {
    revisionHash: computeRevisionHash({
      packageId,
      parentRevisionHash: null,
      artifacts: [{ bundleHash: baseBundleHash, role: 'state' }],
      metadata: {
        author: 'selftest',
        message: 'genesis',
        createdBy: 'selftest',
        timestamp: genesisTimestamp,
        source: 'system',
        tags: ['migration', 'selftest'],
      },
    }),
    packageId,
    parentRevisionHash: null,
    artifacts: [{ bundleHash: baseBundleHash, role: 'state' }],
    metadata: {
      author: 'selftest',
      message: 'genesis',
      createdBy: 'selftest',
      timestamp: genesisTimestamp,
      source: 'system',
      tags: ['migration', 'selftest'],
    },
  };

  const rootRevision: StoredRevision = {
    revisionHash: computeRevisionHash({
      packageId,
      parentRevisionHash: genesisRevision.revisionHash,
      artifacts: [{ bundleHash: derivedBundleHash, role: 'execution' }],
      metadata: {
        author: 'selftest',
        message: 'root',
        createdBy: 'selftest',
        timestamp: rootTimestamp,
        source: 'system',
        tags: ['migration', 'selftest'],
      },
    }),
    packageId,
    parentRevisionHash: genesisRevision.revisionHash,
    artifacts: [{ bundleHash: derivedBundleHash, role: 'execution' }],
    metadata: {
      author: 'selftest',
      message: 'root',
      createdBy: 'selftest',
      timestamp: rootTimestamp,
      source: 'system',
      tags: ['migration', 'selftest'],
    },
  };

  const sourceStore = createInMemoryAdapter();
  await sourceStore.adapter.storeArtifactBundle(baseArtifact);
  await sourceStore.adapter.storeArtifactBundle(derivedArtifact);
  await sourceStore.adapter.createRevision(genesisRevision);
  await sourceStore.adapter.createRevision(rootRevision);

  const service = new MigrationService(sourceStore.adapter);
  const zipPath = path.resolve(process.cwd(), 'dist', 'selftest', 'migration_package_selftest.zip');
  mkdirSync(path.dirname(zipPath), { recursive: true });
  if (existsSync(zipPath)) {
    unlinkSync(zipPath);
  }

  const exportedZipPath = await service.exportMigrationPackage(rootRevision.revisionHash, zipPath);
  assertCondition(exportedZipPath === zipPath);

  const verified = await service.verifyMigrationPackage(zipPath);
  assertCondition(verified.ok === true);
  assertCondition(verified.rootRevisionHash === rootRevision.revisionHash);
  assertCondition(verified.revisionCount === 2);
  assertCondition(verified.artifactCount === 4);

  const importedStore = createInMemoryAdapter();
  const importService = new MigrationService(importedStore.adapter);
  const imported = await importService.importMigrationPackage(zipPath);
  assertCondition(imported.ok === true);
  assertCondition(imported.revisionCount === 2);
  assertCondition(imported.artifactCount === 4);
  assertCondition(importedStore.artifactsByHash.size === 4);
  assertCondition(importedStore.revisionsByHash.size === 2);

  const zipContents = readMigrationPackageZip(zipPath);
  assertCondition(zipContents.manifest.createdAt === rootTimestamp);
  assertCondition(zipContents.manifest.artifactCount === 4);
  assertCondition(zipContents.manifest.revisionCount === 2);

  const parsedArtifacts = parseArtifactsJsonl(zipContents.artifactsJsonl);
  assertCondition(parsedArtifacts.length === 4);

  for (const bundle of parsedArtifacts) {
    const recomputedBundleHash = hashBundle(bundle);
    assertCondition(importedStore.artifactsByHash.has(recomputedBundleHash));
  }

  for (const revision of importedStore.revisionsByHash.values()) {
    const recomputedRevisionHash = computeRevisionHash({
      packageId: revision.packageId,
      parentRevisionHash: revision.parentRevisionHash,
      artifacts: revision.artifacts,
      metadata: revision.metadata,
    });
    assertCondition(recomputedRevisionHash === revision.revisionHash);
  }

  return { zipPath };
}

if (require.main === module) {
  runMigrationSelftest()
    .then(() => {
      process.stdout.write('MIGRATION_SELFTEST_OK\n');
    })
    .catch(() => {
      process.stdout.write('MIGRATION_SELFTEST_FAIL\n');
      process.exit(1);
    });
}
