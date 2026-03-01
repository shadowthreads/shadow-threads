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

function loadModule() {
  const root = path.resolve(__dirname, '../../..');
  const lineageModule = requireFromCandidates([
    path.join(root, 'dist', 'services', 'lineage-binding-v1.js'),
    path.join(root, 'dist', 'src', 'services', 'lineage-binding-v1.js'),
  ]);

  if (
    !lineageModule ||
    typeof lineageModule.buildLineageBindingV1 !== 'function' ||
    typeof lineageModule.verifyLineageBindingV1 !== 'function' ||
    typeof lineageModule.verifyLineageBindingV1OrThrow !== 'function'
  ) {
    throw new Error('unavailable');
  }

  return lineageModule;
}

function makeHex(char) {
  return String(char).repeat(64);
}

function buildSampleInput(createdAt) {
  return {
    identity: {
      packageId: 'pkg-1',
      revisionId: 'rev-1',
      revisionHash: 'rev-hash-1',
      parentRevisionId: null,
    },
    bindings: {
      transfer: {
        schema: 'transfer-package-1',
        transferHash: makeHex('a'),
      },
      closure: null,
      execution: null,
      handoff: null,
    },
    diagnostics: {
      notes: [],
    },
    createdAt,
  };
}

function main() {
  try {
    const lineageModule = loadModule();

    const first = lineageModule.buildLineageBindingV1(buildSampleInput(null));
    const verification = lineageModule.verifyLineageBindingV1(first);

    const second = lineageModule.buildLineageBindingV1(buildSampleInput('2025-01-01T00:00:00.000Z'));
    const third = lineageModule.buildLineageBindingV1(buildSampleInput('2026-01-01T00:00:00.000Z'));

    const mutated = {
      ...first,
      bindings: {
        ...first.bindings,
        transfer: {
          schema: 'transfer-package-1',
          transferHash: makeHex('b'),
        },
      },
    };
    const mismatch = lineageModule.verifyLineageBindingV1(mutated);

    let throwMatches = false;
    try {
      lineageModule.verifyLineageBindingV1OrThrow(mutated);
    } catch (error) {
      throwMatches =
        !!error &&
        typeof error === 'object' &&
        error.code === 'E_LINEAGE_HASH_MISMATCH' &&
        error.message === 'Lineage binding hash mismatch';
    }

    let jsonSafeMatches = false;
    try {
      lineageModule.buildLineageBindingV1({
        identity: {
          packageId: 'pkg-1',
          revisionId: 'rev-1',
          revisionHash: 'rev-hash-1',
          parentRevisionId: null,
        },
        diagnostics: {
          notes: [BigInt(1)],
        },
      });
    } catch (error) {
      jsonSafeMatches =
        !!error &&
        typeof error === 'object' &&
        error.code === 'E_LINEAGE_NON_JSON_SAFE' &&
        error.message === 'Lineage binding contains non JSON-safe value';
    }

    const ok =
      verification.ok === true &&
      verification.matches === true &&
      first.createdAt === null &&
      second.createdAt === '2025-01-01T00:00:00.000Z' &&
      third.createdAt === '2026-01-01T00:00:00.000Z' &&
      second.lineageHash === third.lineageHash &&
      mismatch.ok === true &&
      mismatch.matches === false &&
      throwMatches === true &&
      jsonSafeMatches === true;

    process.stdout.write(ok ? 'LINEAGE_SELFTEST_OK\n' : 'LINEAGE_SELFTEST_FAIL\n');
    process.exit(ok ? 0 : 1);
  } catch (_error) {
    process.stdout.write('LINEAGE_SELFTEST_FAIL\n');
    process.exit(1);
  }
}

main();
