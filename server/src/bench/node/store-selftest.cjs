const fs = require('fs');
const path = require('path');

function requireFromCandidates(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
  }
  throw new Error('unavailable');
}

function loadModules() {
  const root = path.resolve(__dirname, '../../..');
  const transferModule = requireFromCandidates([
    path.join(root, 'dist', 'services', 'transfer-package-v1.js'),
    path.join(root, 'dist', 'src', 'services', 'transfer-package-v1.js'),
  ]);
  const lineageModule = requireFromCandidates([
    path.join(root, 'dist', 'services', 'lineage-binding-v1.js'),
    path.join(root, 'dist', 'src', 'services', 'lineage-binding-v1.js'),
  ]);
  const handoffModule = requireFromCandidates([
    path.join(root, 'dist', 'services', 'handoff-record-v1.js'),
    path.join(root, 'dist', 'src', 'services', 'handoff-record-v1.js'),
  ]);
  const bundleModule = requireFromCandidates([
    path.join(root, 'dist', 'services', 'artifact-bundle-v1.js'),
    path.join(root, 'dist', 'src', 'services', 'artifact-bundle-v1.js'),
  ]);
  const storeModule = requireFromCandidates([
    path.join(root, 'dist', 'services', 'artifact-store-v1.js'),
    path.join(root, 'dist', 'src', 'services', 'artifact-store-v1.js'),
  ]);

  if (
    typeof transferModule.buildTransferPackageV1 !== 'function' ||
    typeof lineageModule.buildLineageBindingV1 !== 'function' ||
    typeof handoffModule.buildHandoffRecordV1 !== 'function' ||
    typeof bundleModule.buildArtifactBundleV1 !== 'function' ||
    typeof storeModule.buildArtifactStoreRecordV1 !== 'function' ||
    typeof storeModule.verifyArtifactStoreRecordV1 !== 'function'
  ) {
    throw new Error('unavailable');
  }

  return { transferModule, lineageModule, handoffModule, bundleModule, storeModule };
}

function buildTransferPackage(transferModule) {
  return transferModule.buildTransferPackageV1({
    identity: {
      packageId: 'pkg-1',
      revisionId: 'rev-1',
      revisionHash: 'rev-hash-1',
      parentRevisionId: null,
    },
    bindings: {
      closureContractV1: null,
      applyReportV1Hash: null,
      executionRecordV1Hash: null,
    },
    trunk: {
      intent: { primary: null, successCriteria: [], nonGoals: [] },
      stateDigest: { facts: ['fact-a'], decisions: [], constraints: [], risks: [], assumptions: [], openLoops: [] },
    },
    continuation: { nextActions: [], validationChecklist: [] },
    conflicts: [],
  });
}

function buildBundle(transferModule, lineageModule, handoffModule, bundleModule) {
  const transferPackageV1 = buildTransferPackage(transferModule);
  const lineageBindingV1 = lineageModule.buildLineageBindingV1({
    identity: {
      packageId: transferPackageV1.identity.packageId,
      revisionId: transferPackageV1.identity.revisionId,
      revisionHash: transferPackageV1.identity.revisionHash,
      parentRevisionId: transferPackageV1.identity.parentRevisionId,
    },
    bindings: {
      transfer: { schema: 'transfer-package-1', transferHash: transferPackageV1.transferHash },
      closure: null,
      execution: null,
      handoff: null,
    },
    diagnostics: { notes: [] },
    createdAt: null,
  });
  const handoffRecordV1 = handoffModule.buildHandoffRecordV1({
    transferPackageV1,
    verification: { transferHashRecomputed: transferPackageV1.transferHash, matchesProvidedHash: true },
    bindings: { closureContractV1: null, applyReportV1Hash: null, executionRecordV1Hash: null },
    lineageBindingV1,
    createdAt: null,
  });
  return bundleModule.buildArtifactBundleV1({
    identity: {
      packageId: transferPackageV1.identity.packageId,
      revisionId: transferPackageV1.identity.revisionId,
      revisionHash: transferPackageV1.identity.revisionHash,
    },
    artifacts: {
      transferPackageV1,
      lineageBindingV1,
      handoffRecordV1,
      closureContractV1: null,
    },
    diagnostics: { notes: [] },
    createdAt: null,
  });
}

function buildStoreRecord(storeModule, bundle, createdAt) {
  return storeModule.buildArtifactStoreRecordV1({
    identity: {
      packageId: bundle.identity.packageId,
      revisionId: bundle.identity.revisionId,
      revisionHash: bundle.identity.revisionHash,
    },
    artifactBundleV1: bundle,
    createdAt,
    diagnostics: { notes: [] },
  });
}

function main() {
  try {
    const { transferModule, lineageModule, handoffModule, bundleModule, storeModule } = loadModules();
    const bundle = buildBundle(transferModule, lineageModule, handoffModule, bundleModule);
    const storeA = buildStoreRecord(storeModule, bundle, '2025-01-01T00:00:00.000Z');
    const storeB = buildStoreRecord(storeModule, bundle, '2026-01-01T00:00:00.000Z');
    const mismatch = {
      ...storeA,
      artifactBundleV1: {
        ...storeA.artifactBundleV1,
        artifacts: {
          ...storeA.artifactBundleV1.artifacts,
          handoffRecordV1: {
            ...storeA.artifactBundleV1.artifacts.handoffRecordV1,
            lineageBindingV1: {
              ...storeA.artifactBundleV1.artifacts.handoffRecordV1.lineageBindingV1,
              bindings: {
                ...storeA.artifactBundleV1.artifacts.handoffRecordV1.lineageBindingV1.bindings,
                transfer: { schema: 'transfer-package-1', transferHash: 'f'.repeat(64) },
              },
            },
          },
        },
      },
    };
    const verification = storeModule.verifyArtifactStoreRecordV1(mismatch);

    const ok =
      storeA.storeHash === storeB.storeHash &&
      storeA.createdAt === '2025-01-01T00:00:00.000Z' &&
      storeB.createdAt === '2026-01-01T00:00:00.000Z' &&
      verification.ok === true &&
      verification.matches === false;

    process.stdout.write(ok ? 'STORE_SELFTEST_OK\n' : 'STORE_SELFTEST_FAIL\n');
    process.exit(ok ? 0 : 1);
  } catch (_error) {
    process.stdout.write('STORE_SELFTEST_FAIL\n');
    process.exit(1);
  }
}

main();
