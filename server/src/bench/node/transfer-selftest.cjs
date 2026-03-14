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

function loadTransferModule() {
  const root = path.resolve(__dirname, '../../..');
  const transferModule = requireFromCandidates([
    path.join(root, 'dist', 'services', 'transfer-package-v1.js'),
    path.join(root, 'dist', 'src', 'services', 'transfer-package-v1.js'),
  ]);

  if (
    !transferModule ||
    typeof transferModule.buildTransferPackageV1 !== 'function' ||
    typeof transferModule.stableStringify !== 'function'
  ) {
    throw new Error('unavailable');
  }

  return transferModule;
}

function makeInput() {
  return {
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
        successCriteria: ['verify', 'ship'],
        nonGoals: ['scope-creep'],
      },
      stateDigest: {
        facts: ['fact-a'],
        openLoops: ['loop-a'],
      },
    },
    continuation: {
      nextActions: [
        {
          code: 'NEXT_VERIFY',
          message: 'Verify transfer',
          expectedOutput: null,
          domains: ['facts', 'decisions'],
        },
      ],
      validationChecklist: [
        {
          code: 'CHECK_HASH',
          message: 'Check transfer hash',
          severity: 'must',
        },
      ],
    },
    conflicts: [],
  };
}

function main() {
  try {
    const transferModule = loadTransferModule();
    const input = makeInput();
    const first = transferModule.buildTransferPackageV1(input);
    const second = transferModule.buildTransferPackageV1(input);

    if (first.bindings.closureContractV1 !== null) {
      throw new Error('fail');
    }
    if (transferModule.stableStringify(first) !== transferModule.stableStringify(second)) {
      throw new Error('fail');
    }

    let nonJsonSafeCaught = false;
    try {
      transferModule.buildTransferPackageV1({
        identity: {
          packageId: 'pkg-1',
          revisionId: 'rev-1',
          revisionHash: 'rev-hash-1',
          parentRevisionId: null,
        },
        trunk: {
          intent: {
            primary: BigInt(1),
          },
        },
      });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        error.code === 'E_TRANSFER_NON_JSON_SAFE' &&
        error.message === 'Transfer package contains non JSON-safe value'
      ) {
        nonJsonSafeCaught = true;
      }
    }

    if (!nonJsonSafeCaught) {
      throw new Error('fail');
    }

    process.stdout.write('TRANSFER_SELFTEST_OK\n');
    process.exit(0);
  } catch (_error) {
    process.stdout.write('TRANSFER_SELFTEST_FAIL\n');
    process.exit(1);
  }
}

main();
