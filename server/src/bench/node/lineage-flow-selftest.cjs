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
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};

  try {
    const transferModule = requireFromCandidates([
      path.join(root, 'dist', 'services', 'transfer-package-v1.js'),
      path.join(root, 'dist', 'src', 'services', 'transfer-package-v1.js'),
    ]);
    const serviceModule = requireFromCandidates([
      path.join(root, 'dist', 'services', 'transfer-package.service.js'),
      path.join(root, 'dist', 'src', 'services', 'transfer-package.service.js'),
    ]);
    const lineageModule = requireFromCandidates([
      path.join(root, 'dist', 'services', 'lineage-binding-v1.js'),
      path.join(root, 'dist', 'src', 'services', 'lineage-binding-v1.js'),
    ]);

    if (
      !transferModule ||
      typeof transferModule.buildTransferPackageV1 !== 'function' ||
      !serviceModule ||
      typeof serviceModule.buildLineageBindingForTransferFlowV1 !== 'function' ||
      !lineageModule ||
      typeof lineageModule.verifyLineageBindingV1 !== 'function'
    ) {
      throw new Error('unavailable');
    }

    return { transferModule, serviceModule, lineageModule };
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
  }
}

function makeHex(char) {
  return String(char).repeat(64);
}

function buildTransfer(transferModule) {
  return transferModule.buildTransferPackageV1({
    identity: {
      packageId: 'pkg-1',
      revisionId: 'rev-1',
      revisionHash: 'rev-hash-1',
      parentRevisionId: null,
    },
    trunk: {
      intent: {
        primary: null,
        successCriteria: [],
        nonGoals: [],
      },
      stateDigest: {
        facts: ['fact-a'],
      },
    },
    continuation: {
      nextActions: [],
      validationChecklist: [],
    },
    conflicts: [],
  });
}

function main() {
  try {
    const { transferModule, serviceModule, lineageModule } = loadModules();
    const transferPackageV1 = buildTransfer(transferModule);

    const first = serviceModule.buildLineageBindingForTransferFlowV1({
      transferPackageV1,
      include: {
        closure: true,
        execution: false,
        handoff: false,
      },
      closureContractV1: {
        schema: 'closure-contract-1',
        proposedHash: makeHex('a'),
        acceptedHash: makeHex('b'),
      },
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const second = serviceModule.buildLineageBindingForTransferFlowV1({
      transferPackageV1,
      include: {
        closure: true,
        execution: false,
        handoff: false,
      },
      closureContractV1: {
        schema: 'closure-contract-1',
        proposedHash: makeHex('a'),
        acceptedHash: makeHex('b'),
      },
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const firstVerification = lineageModule.verifyLineageBindingV1(first);
    const secondVerification = lineageModule.verifyLineageBindingV1(second);

    const ok =
      firstVerification.ok === true &&
      firstVerification.matches === true &&
      secondVerification.ok === true &&
      secondVerification.matches === true &&
      first.lineageHash === second.lineageHash &&
      first.createdAt === '2025-01-01T00:00:00.000Z' &&
      second.createdAt === '2026-01-01T00:00:00.000Z' &&
      first.bindings.transfer.transferHash === transferPackageV1.transferHash &&
      second.bindings.transfer.transferHash === transferPackageV1.transferHash;

    process.stdout.write(ok ? 'LINEAGE_FLOW_SELFTEST_OK\n' : 'LINEAGE_FLOW_SELFTEST_FAIL\n');
    process.exit(ok ? 0 : 1);
  } catch (_error) {
    process.stdout.write('LINEAGE_FLOW_SELFTEST_FAIL\n');
    process.exit(1);
  }
}

main();
