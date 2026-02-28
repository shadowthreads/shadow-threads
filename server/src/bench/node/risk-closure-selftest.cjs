const fs = require('fs');
const path = require('path');

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function stableStringify(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (!value || typeof value !== 'object') {
    return JSON.stringify(null);
  }

  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort((left, right) => compareStrings(left[0], right[0]));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
}

function requireFromCandidates(candidates) {
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    return require(candidate);
  }
  throw new Error('unsupported baseline');
}

function main() {
  try {
    const root = path.resolve(__dirname, '../../..');
    const plannerModule = requireFromCandidates([
      path.join(root, 'dist', 'services', 'delta-closure-planner.js'),
      path.join(root, 'dist', 'src', 'services', 'delta-closure-planner.js'),
    ]);
    const policyModule = requireFromCandidates([
      path.join(root, 'dist', 'services', 'delta-risk-policy.js'),
      path.join(root, 'dist', 'src', 'services', 'delta-risk-policy.js'),
    ]);
    const algebra = requireFromCandidates([
      path.join(root, 'dist', 'algebra', 'index.js'),
      path.join(root, 'dist', 'src', 'algebra', 'index.js'),
    ]);
    const keyModule = requireFromCandidates([
      path.join(root, 'dist', 'algebra', 'semanticDiff', 'key.js'),
      path.join(root, 'dist', 'src', 'algebra', 'semanticDiff', 'key.js'),
    ]);
    const stableHash = typeof algebra.stableHash === 'function' ? algebra.stableHash : keyModule.stableHash;

    if (
      !plannerModule ||
      typeof plannerModule.planDeltaClosureV1 !== 'function' ||
      !policyModule ||
      !policyModule.DEFAULT_RISK_POLICY_V1 ||
      !algebra ||
      typeof algebra.applyDelta !== 'function' ||
      typeof algebra.detectConflicts !== 'function' ||
      typeof stableHash !== 'function'
    ) {
      process.stdout.write('RISK_CLOSURE_SELFTEST_FAIL\n');
      process.exit(1);
    }

    const baseState = {
      facts: [{ key: 'fact.alpha', value: 'alpha' }],
      decisions: [],
      constraints: [],
      risks: [],
      assumptions: [],
    };

    const proposedDelta = {
      schemaVersion: 'sdiff-0.1',
      base: { revisionHash: 'selftest-base' },
      target: { revisionHash: 'selftest-target' },
      facts: { added: [], removed: [], modified: [] },
      decisions: {
        added: [],
        removed: [],
        modified: [
          {
            key: 'decision.missing',
            before: null,
            after: { key: 'decision.missing', answer: 'accepted' },
            changes: [{ path: 'answer', op: 'set', after: 'accepted' }],
          },
        ],
      },
      constraints: { added: [], removed: [], modified: [] },
      risks: { added: [], removed: [], modified: [] },
      assumptions: { added: [], removed: [], modified: [] },
      meta: {
        determinism: {
          canonicalVersion: 'tpkg-0.2-canon-v1',
          keyStrategy: 'sig-hash-v1',
          tieBreakers: ['risk-closure-selftest'],
        },
        collisions: { hard: [], soft: [] },
        counts: {
          'facts.added': 0,
          'facts.removed': 0,
          'facts.modified': 0,
          'decisions.added': 0,
          'decisions.removed': 0,
          'decisions.modified': 1,
          'constraints.added': 0,
          'constraints.removed': 0,
          'constraints.modified': 0,
          'risks.added': 0,
          'risks.removed': 0,
          'risks.modified': 0,
          'assumptions.added': 0,
          'assumptions.removed': 0,
          'assumptions.modified': 0,
          'collisions.soft': 0,
          'collisions.hard': 0,
        },
      },
    };

    const planA = plannerModule.planDeltaClosureV1({
      baseState,
      proposedDelta,
      mode: 'strict',
      policy: policyModule.DEFAULT_RISK_POLICY_V1,
    });
    const planB = plannerModule.planDeltaClosureV1({
      baseState,
      proposedDelta,
      mode: 'strict',
      policy: policyModule.DEFAULT_RISK_POLICY_V1,
    });

    const hasRejectedRisk = Array.isArray(planA.rejected) && planA.rejected.some((entry) => entry && (entry.riskLevel === 'L2' || entry.riskLevel === 'L3'));
    const hasSuggestion = Array.isArray(planA.suggestions) && planA.suggestions.some((entry) => entry && entry.suggestionCode === 'SUGGEST_ADD_MISSING');
    const transition = algebra.applyDelta(baseState, planA.acceptedDelta, { mode: 'best_effort' });
    const postApplyConflicts = algebra.detectConflicts(transition.nextState);
    const sameAccepted = stableHash(planA.acceptedDelta) === stableHash(planB.acceptedDelta);
    const sameRejected = stableStringify(planA.rejected) === stableStringify(planB.rejected);

    if (!hasRejectedRisk || !hasSuggestion || postApplyConflicts.length !== 0 || !sameAccepted || !sameRejected) {
      process.stdout.write('RISK_CLOSURE_SELFTEST_FAIL\n');
      process.exit(1);
    }

    process.stdout.write('RISK_CLOSURE_SELFTEST_OK\n');
    process.exit(0);
  } catch (_error) {
    process.stdout.write('RISK_CLOSURE_SELFTEST_FAIL\n');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
