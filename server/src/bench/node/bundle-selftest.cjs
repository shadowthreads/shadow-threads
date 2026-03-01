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

  if (
    typeof transferModule.buildTransferPackageV1 !== 'function' ||
    typeof lineageModule.buildLineageBindingV1 !== 'function' ||
    typeof handoffModule.buildHandoffRecordV1 !== 'function' ||
    typeof bundleModule.buildArtifactBundleV1 !== 'function' ||
    typeof bundleModule.verifyArtifactBundleV1 !== 'function'
  ) {
    throw new Error('unavailable');
  }

  return { transferModule, lineageModule, handoffModule, bundleModule };
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
      intent: {
        primary: null,
        successCriteria: [],
        nonGoals: [],
      },
      stateDigest: {
        facts: ['fact-a'],
        decisions: [],
        constraints: [],
        risks: [],
        assumptions: [],
        openLoops: [],
      },
    },
    continuation: {
      nextActions: [],
      validationChecklist: [],
    },
    conflicts: [],
  });
}

function buildLineage(lineageModule, transferPackageV1, lineageHashChar) {
  const lineageBindingV1 = lineageModule.buildLineageBindingV1({
    identity: {
      packageId: transferPackageV1.identity.packageId,
      revisionId: transferPackageV1.identity.revisionId,
      revisionHash: transferPackageV1.identity.revisionHash,
      parentRevisionId: transferPackageV1.identity.parentRevisionId,
    },
    bindings: {
      transfer: {
        schema: 'transfer-package-1',
        transferHash: transferPackageV1.transferHash,
      },
      closure: null,
      execution: null,
      handoff: null,
    },
    diagnostics: {
      notes: [],
    },
    createdAt: null,
  });
  if (!lineageHashChar) {
    return lineageBindingV1;
  }
  return {
    ...lineageBindingV1,
    lineageHash: String(lineageHashChar).repeat(64),
  };
}

function buildHandoff(handoffModule, transferPackageV1, lineageBindingV1, createdAt) {
  return handoffModule.buildHandoffRecordV1({
    transferPackageV1,
    verification: {
      transferHashRecomputed: transferPackageV1.transferHash,
      matchesProvidedHash: true,
    },
    bindings: {
      closureContractV1: null,
      applyReportV1Hash: null,
      executionRecordV1Hash: null,
    },
    lineageBindingV1,
    createdAt,
  });
}

function buildBundle(bundleModule, transferPackageV1, lineageBindingV1, handoffRecordV1, createdAt) {
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
    diagnostics: {
      notes: [],
    },
    createdAt,
  });
}

function main() {
  try {
    const { transferModule, lineageModule, handoffModule, bundleModule } = loadModules();
    const transferPackageV1 = buildTransferPackage(transferModule);
    const lineageBindingV1 = buildLineage(lineageModule, transferPackageV1, null);
    const handoffRecordV1 = buildHandoff(handoffModule, transferPackageV1, lineageBindingV1, null);

    const bundleA = buildBundle(bundleModule, transferPackageV1, lineageBindingV1, handoffRecordV1, null);
    const bundleB = buildBundle(bundleModule, transferPackageV1, lineageBindingV1, handoffRecordV1, null);

    const mismatchBundle = {
      ...bundleA,
      artifacts: {
        ...bundleA.artifacts,
        handoffRecordV1: {
          ...bundleA.artifacts.handoffRecordV1,
          lineageBindingV1: {
            ...bundleA.artifacts.handoffRecordV1.lineageBindingV1,
            bindings: {
              ...bundleA.artifacts.handoffRecordV1.lineageBindingV1.bindings,
              transfer: {
                schema: 'transfer-package-1',
                transferHash: 'f'.repeat(64),
              },
            },
          },
        },
      },
    };
    const mismatchVerification = bundleModule.verifyArtifactBundleV1(mismatchBundle);

    const inconsistentTopLineage = buildLineage(lineageModule, transferPackageV1, 'e');
    const invariantFailureBundle = buildBundle(
      bundleModule,
      transferPackageV1,
      inconsistentTopLineage,
      handoffRecordV1,
      null
    );
    const invariantFailureVerification = bundleModule.verifyArtifactBundleV1(invariantFailureBundle);
    const embeddedLineageInvariant = invariantFailureBundle.diagnostics.invariants.find(
      (entry) => entry.code === 'INV_EMBEDDED_LINEAGE_HASH_MATCH_TOP'
    );

    const bundleWithCreatedAtA = buildBundle(bundleModule, transferPackageV1, lineageBindingV1, handoffRecordV1, '2025-01-01T00:00:00.000Z');
    const bundleWithCreatedAtB = buildBundle(bundleModule, transferPackageV1, lineageBindingV1, handoffRecordV1, '2026-01-01T00:00:00.000Z');

    const ok =
      bundleA.bundleHash === bundleB.bundleHash &&
      bundleModule.stableStringify(bundleA) === bundleModule.stableStringify(bundleB) &&
      mismatchVerification.ok === true &&
      mismatchVerification.matches === false &&
      invariantFailureVerification.ok === true &&
      invariantFailureVerification.matches === true &&
      !!embeddedLineageInvariant &&
      embeddedLineageInvariant.ok === false &&
      bundleWithCreatedAtA.bundleHash === bundleWithCreatedAtB.bundleHash;

    process.stdout.write(ok ? 'BUNDLE_SELFTEST_OK\n' : 'BUNDLE_SELFTEST_FAIL\n');
    process.exit(ok ? 0 : 1);
  } catch (_error) {
    process.stdout.write('BUNDLE_SELFTEST_FAIL\n');
    process.exit(1);
  }
}

main();
