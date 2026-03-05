import { computeBundleHash } from '../lib/artifact-hash';
import { ArtifactConflictError, ArtifactStoreService } from '../services/artifact-store.service';
import { prisma } from '../utils';

export async function runArtifactStoreSelftest(): Promise<void> {
  const service = new ArtifactStoreService();

  const identity = {
    packageId: 'artifact-selftest-package',
    revisionId: 'artifact-selftest-rev',
    revisionHash: 'artifact-selftest-revision-hash',
  };

  const schema = 'artifact-bundle-1';
  const payload = {
    schema: 'artifact-bundle-1',
    identity: {
      packageId: identity.packageId,
      revisionId: identity.revisionId,
      revisionHash: identity.revisionHash,
    },
    artifacts: {
      transferPackageV1: { transferHash: 'a'.repeat(64) },
      lineageBindingV1: { lineageHash: 'b'.repeat(64) },
      handoffRecordV1: { handoffHash: 'c'.repeat(64) },
      closureContractV1: null,
    },
  };

  const bundleHash = computeBundleHash({
    schema,
    packageId: identity.packageId,
    revisionId: identity.revisionId,
    revisionHash: identity.revisionHash,
    payload,
  });

  const stored = await service.storeArtifactBundle({
    schema,
    identity,
    payload,
    bundleHash,
  });

  const loaded = await service.loadArtifactBundle({
    packageId: identity.packageId,
    bundleHash,
  });

  if (!loaded) {
    throw new Error('selftest_failed');
  }

  const verification = service.verifyArtifactBundle({
    schema,
    identity,
    payload,
    bundleHash,
  });

  if (!verification.ok) {
    throw new Error('selftest_failed');
  }

  const storedAgain = await service.storeArtifactBundle({
    schema,
    identity,
    payload,
    bundleHash,
  });

  if (stored.bundleHash !== storedAgain.bundleHash) {
    throw new Error('selftest_failed');
  }

  let conflictSeen = false;
  try {
    await service.storeArtifactBundle({
      schema,
      identity,
      payload: {
        ...payload,
        artifacts: {
          ...payload.artifacts,
          transferPackageV1: { transferHash: 'd'.repeat(64) },
        },
      },
      bundleHash,
    });
  } catch (error) {
    if (error instanceof ArtifactConflictError) {
      conflictSeen = true;
    } else {
      throw error;
    }
  }

  if (!conflictSeen) {
    throw new Error('selftest_failed');
  }

  const payloadWithNullByte = {
    schema: 'artifact-bundle-1',
    identity: {
      packageId: 'artifact-selftest-package-null',
      revisionId: 'artifact-selftest-rev-null',
      revisionHash: 'artifact-selftest-revision-hash-null',
    },
    notes: 'before\u0000after',
    artifacts: {
      transferPackageV1: { transferHash: 'e'.repeat(64) },
      lineageBindingV1: { lineageHash: 'f'.repeat(64) },
      handoffRecordV1: { handoffHash: '0'.repeat(64) },
      closureContractV1: null,
    },
  };

  const storedWithSanitizedPayload = await service.storeArtifactBundle({
    schema,
    identity: {
      packageId: payloadWithNullByte.identity.packageId,
      revisionId: payloadWithNullByte.identity.revisionId,
      revisionHash: payloadWithNullByte.identity.revisionHash,
    },
    payload: payloadWithNullByte,
  });

  const loadedWithSanitizedPayload = await service.loadArtifactBundle({
    packageId: payloadWithNullByte.identity.packageId,
    bundleHash: storedWithSanitizedPayload.bundleHash,
  });

  if (!loadedWithSanitizedPayload) {
    throw new Error('selftest_failed');
  }

  if (!loadedWithSanitizedPayload.payload || typeof loadedWithSanitizedPayload.payload !== 'object') {
    throw new Error('selftest_failed');
  }

  const loadedPayloadRecord = loadedWithSanitizedPayload.payload as Record<string, unknown>;
  if (loadedPayloadRecord.notes !== 'beforeafter') {
    throw new Error('selftest_failed');
  }
}

async function main(): Promise<void> {
  let exitCode = 0;
  try {
    await runArtifactStoreSelftest();
    process.stdout.write('ARTIFACT_STORE_SELFTEST_OK\n');
  } catch {
    process.stdout.write('ARTIFACT_STORE_SELFTEST_FAIL\n');
    exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

if (require.main === module) {
  void main();
}