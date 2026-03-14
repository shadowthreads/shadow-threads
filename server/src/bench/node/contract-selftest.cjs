const path = require('path');

function main() {
  try {
    const root = path.resolve(__dirname, '../../..');
    const contractModule = require(path.join(root, 'dist', 'services', 'closure-contract-v1.js'));
    const { buildClosureContractV1, stableStringify, assertJsonSafe } = contractModule;

    const proposedDelta = {
      schema: 'sdiff-0.1',
      facts: { added: [{ key: 'fact-a', after: { key: 'fact-a', statement: 'A' } }], removed: [], modified: [] },
      decisions: { added: [], removed: [], modified: [] },
      constraints: { added: [], removed: [], modified: [] },
      risks: { added: [], removed: [], modified: [] },
      assumptions: { added: [], removed: [], modified: [] },
      meta: {
        counts: {
          'facts.added': 1,
          'facts.removed': 0,
          'facts.modified': 0,
          'decisions.added': 0,
          'decisions.removed': 0,
          'decisions.modified': 0,
          'constraints.added': 0,
          'constraints.removed': 0,
          'constraints.modified': 0,
          'risks.added': 0,
          'risks.removed': 0,
          'risks.modified': 0,
          'assumptions.added': 0,
          'assumptions.removed': 0,
          'assumptions.modified': 0,
        },
        collisions: { soft: [], hard: [] },
      },
    };

    const acceptedDelta = {
      schema: 'sdiff-0.1',
      facts: { added: [], removed: [], modified: [] },
      decisions: { added: [], removed: [], modified: [] },
      constraints: { added: [], removed: [], modified: [] },
      risks: { added: [], removed: [], modified: [] },
      assumptions: { added: [], removed: [], modified: [] },
      meta: {
        counts: {
          'facts.added': 0,
          'facts.removed': 0,
          'facts.modified': 0,
          'decisions.added': 0,
          'decisions.removed': 0,
          'decisions.modified': 0,
          'constraints.added': 0,
          'constraints.removed': 0,
          'constraints.modified': 0,
          'risks.added': 0,
          'risks.removed': 0,
          'risks.modified': 0,
          'assumptions.added': 0,
          'assumptions.removed': 0,
          'assumptions.modified': 0,
        },
        collisions: { soft: [], hard: [] },
      },
    };

    const rejected = [
      {
        domain: 'facts',
        key: 'fact-a',
        path: null,
        op: 'add',
        reasonCode: 'CONFLICT',
        reasonMessage: 'Rejected: conflict',
        riskLevel: 'L2',
        blockedBy: [
          {
            domain: 'facts',
            key: 'fact-a',
            path: null,
          },
        ],
      },
    ];

    const suggestions = [
      {
        schema: 'closure-suggestion-1',
        code: 'ADD_MISSING_DEP',
        message: 'Add missing dependency',
        actionType: 'ADD_MISSING_DEP',
        payload: {
          appliesTo: {
            domain: 'facts',
            key: 'fact-a',
            path: null,
            op: 'add',
          },
          blockedBy: [
            {
              domain: 'facts',
              key: 'fact-a',
              path: null,
            },
          ],
        },
        riskLevel: 'L2',
      },
    ];

    const diagnostics = {
      closureViolationFlag: false,
      maxClosureSizeRatio: 0,
      blockedByRate: 1,
      rejectedCount: 1,
    };

    const contractA = buildClosureContractV1({
      proposedDelta,
      acceptedDelta,
      rejected,
      suggestions,
      diagnostics,
    });
    const contractB = buildClosureContractV1({
      proposedDelta,
      acceptedDelta,
      rejected,
      suggestions,
      diagnostics,
    });

    assertJsonSafe(contractA);
    const serializedA = stableStringify(contractA);
    const serializedB = stableStringify(contractB);

    if (!contractA || contractA.schema !== 'closure-contract-1') {
      throw new Error('fail');
    }
    if (serializedA !== serializedB) {
      throw new Error('fail');
    }

    process.stdout.write('CONTRACT_SELFTEST_OK\n');
    process.exit(0);
  } catch (_error) {
    process.stdout.write('CONTRACT_SELFTEST_FAIL\n');
    process.exit(1);
  }
}

main();
