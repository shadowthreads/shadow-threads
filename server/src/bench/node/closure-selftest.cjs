const path = require('path');

const { applyDelta, detectConflicts, stableHash } = require('./algebra-bridge.cjs');

function loadClosurePlanner() {
  const root = path.resolve(__dirname, '../../..');
  const plannerPath = path.join(root, 'dist', 'src', 'services', 'delta-closure-planner.js');
  const loaded = require(plannerPath);
  if (!loaded || typeof loaded.planDeltaClosure !== 'function') {
    throw new Error('planner unavailable');
  }
  return loaded.planDeltaClosure;
}

function makeProposedDelta() {
  return {
    schemaVersion: 'sdiff-0.1',
    base: { revisionHash: 'selftest-base' },
    target: { revisionHash: 'selftest-target' },
    facts: { added: [], removed: [], modified: [] },
    decisions: {
      added: [],
      removed: [],
      modified: [
        {
          key: 'd1',
          before: { id: 'd1', question: 'ship?', answer: 'no' },
          after: { id: 'd1', question: 'ship?', answer: 'yes' },
          changes: [
            { path: 'id', op: 'set', after: 'd2' },
            { path: 'id.meta', op: 'set', after: 'x' },
          ],
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
        tieBreakers: ['closure-selftest'],
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
}

function runSelftest() {
  const planDeltaClosure = loadClosurePlanner();
  const baseState = {
    facts: [],
    decisions: [
      { id: 'd1', question: 'ship?', answer: 'no' },
      { id: 'd2', question: 'ship?', answer: 'yes' },
    ],
    constraints: [],
    risks: [],
    assumptions: [],
  };

  const proposedDelta = makeProposedDelta();
  const planA = planDeltaClosure({
    baseState,
    proposedDelta,
    mode: 'strict',
    policy: { requirePostApplyZeroConflicts: true },
  });

  const hasDependencyBlocked = planA.rejected.some(
    (entry) => entry.reasonCode === 'DEPENDENCY_BLOCKED' && Array.isArray(entry.blockedBy) && entry.blockedBy.length > 0
  );

  const transition = applyDelta(baseState, planA.acceptedDelta, { mode: 'best_effort' });
  const postApplyConflicts = detectConflicts(transition.nextState);

  const planB = planDeltaClosure({
    baseState,
    proposedDelta,
    mode: 'strict',
    policy: { requirePostApplyZeroConflicts: true },
  });

  const deterministic =
    stableHash(planA.acceptedDelta) === stableHash(planB.acceptedDelta) &&
    stableHash(planA.rejected) === stableHash(planB.rejected);

  const ok = hasDependencyBlocked && postApplyConflicts.length === 0 && deterministic;
  process.stdout.write(ok ? 'CLOSURE_SELFTEST_OK\n' : 'CLOSURE_SELFTEST_FAIL\n');
  process.exit(ok ? 0 : 1);
}

try {
  runSelftest();
} catch (_error) {
  process.stdout.write('CLOSURE_SELFTEST_FAIL\n');
  process.exit(1);
}
