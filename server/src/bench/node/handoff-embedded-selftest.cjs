const fs = require('fs');
const path = require('path');

function requireFromCandidates(candidates) {
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    return require(candidate);
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

  if (
    !transferModule ||
    typeof transferModule.buildTransferPackageV1 !== 'function' ||
    !lineageModule ||
    typeof lineageModule.buildLineageBindingV1 !== 'function' ||
    !handoffModule ||
    typeof handoffModule.buildHandoffRecordV1 !== 'function' ||
    typeof handoffModule.verifyHandoffRecordV1 !== 'function'
  ) {
    throw new Error('unavailable');
  }

  return { transferModule, lineageModule, handoffModule };
}

function makeHex(char) {
  return String(char).repeat(64);
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

function buildLineageBinding(lineageModule, transferPackageV1) {
  return lineageModule.buildLineageBindingV1({
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
}

function buildHandoffRecord(handoffModule, transferPackageV1, lineageBindingV1, createdAt) {
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

function main() {
  try {
    const { transferModule, lineageModule, handoffModule } = loadModules();
    const transferPackageV1 = buildTransferPackage(transferModule);
    const lineageBindingV1 = buildLineageBinding(lineageModule, transferPackageV1);

    const baseline = buildHandoffRecord(handoffModule, transferPackageV1, lineageBindingV1, null);
    const verification = handoffModule.verifyHandoffRecordV1(baseline);

    const handoffA = buildHandoffRecord(
      handoffModule,
      transferPackageV1,
      lineageBindingV1,
      '2025-01-01T00:00:00.000Z'
    );
    const handoffB = buildHandoffRecord(
      handoffModule,
      transferPackageV1,
      lineageBindingV1,
      '2026-01-01T00:00:00.000Z'
    );

    const mutated = {
      ...baseline,
      lineageBindingV1: {
        ...baseline.lineageBindingV1,
        bindings: {
          ...baseline.lineageBindingV1.bindings,
          transfer: {
            schema: 'transfer-package-1',
            transferHash: makeHex('b'),
          },
        },
      },
    };
    const mismatch = handoffModule.verifyHandoffRecordV1(mutated);

    const ok =
      verification.ok === true &&
      verification.matches === true &&
      handoffA.handoffHash === handoffB.handoffHash &&
      handoffA.createdAt === '2025-01-01T00:00:00.000Z' &&
      handoffB.createdAt === '2026-01-01T00:00:00.000Z' &&
      handoffA.lineageBindingV1.lineageHash === handoffB.lineageBindingV1.lineageHash &&
      mismatch.ok === true &&
      mismatch.matches === false;

    process.stdout.write(ok ? 'HANDOFF_EMBEDDED_SELFTEST_OK\n' : 'HANDOFF_EMBEDDED_SELFTEST_FAIL\n');
    process.exit(ok ? 0 : 1);
  } catch (_error) {
    process.stdout.write('HANDOFF_EMBEDDED_SELFTEST_FAIL\n');
    process.exit(1);
  }
}

main();
