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
  const handoffModule = requireFromCandidates([
    path.join(root, 'dist', 'services', 'handoff-record-v1.js'),
    path.join(root, 'dist', 'src', 'services', 'handoff-record-v1.js'),
  ]);

  if (
    !transferModule ||
    typeof transferModule.buildTransferPackageV1 !== 'function' ||
    typeof transferModule.verifyTransferPackageV1 !== 'function' ||
    !handoffModule ||
    typeof handoffModule.buildHandoffRecordV1 !== 'function'
  ) {
    throw new Error('unavailable');
  }

  return { transferModule, handoffModule };
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
        primary: 'handoff',
        successCriteria: ['verify'],
        nonGoals: ['drift'],
      },
      stateDigest: {
        facts: ['fact-a'],
        openLoops: ['loop-a'],
      },
    },
    continuation: {
      nextActions: [
        {
          code: 'NEXT',
          message: 'Continue',
          expectedOutput: null,
          domains: ['facts', 'decisions'],
        },
      ],
      validationChecklist: [
        {
          code: 'CHECK',
          message: 'Check',
          severity: 'must',
        },
      ],
    },
    conflicts: [],
  });
}

function main() {
  try {
    const { transferModule, handoffModule } = loadModules();
    const transferPackageV1 = buildTransferPackage(transferModule);
    const verification = transferModule.verifyTransferPackageV1(transferPackageV1);

    const handoffA = handoffModule.buildHandoffRecordV1({
      transferPackageV1,
      verification: {
        transferHashRecomputed: verification.recomputedHash,
        matchesProvidedHash: true,
      },
      bindings: {
        closureContractV1: null,
        applyReportV1Hash: null,
        executionRecordV1Hash: null,
      },
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const handoffB = handoffModule.buildHandoffRecordV1({
      transferPackageV1,
      verification: {
        transferHashRecomputed: verification.recomputedHash,
        matchesProvidedHash: true,
      },
      bindings: {
        closureContractV1: null,
        applyReportV1Hash: null,
        executionRecordV1Hash: null,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const ok =
      handoffA.handoffHash === handoffB.handoffHash &&
      handoffA.createdAt === '2025-01-01T00:00:00.000Z' &&
      handoffB.createdAt === '2026-01-01T00:00:00.000Z';

    process.stdout.write(ok ? 'HANDOFF_SELFTEST_OK\n' : 'HANDOFF_SELFTEST_FAIL\n');
    process.exit(ok ? 0 : 1);
  } catch (_error) {
    process.stdout.write('HANDOFF_SELFTEST_FAIL\n');
    process.exit(1);
  }
}

main();
