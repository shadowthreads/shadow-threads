const fs = require('fs');
const path = require('path');

const { applyDelta, detectConflicts } = require('./algebra-bridge.cjs');

function requireFromCandidates(candidates) {
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    return require(candidate);
  }
  throw new Error('unavailable');
}

function isHex64(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function loadModules() {
  const rootPath = path.resolve(__dirname, '../../..');
  const plannerModule = requireFromCandidates([
    path.join(rootPath, 'dist', 'services', 'delta-closure-planner.js'),
    path.join(rootPath, 'dist', 'src', 'services', 'delta-closure-planner.js'),
  ]);
  const policyModule = requireFromCandidates([
    path.join(rootPath, 'dist', 'services', 'delta-risk-policy.js'),
    path.join(rootPath, 'dist', 'src', 'services', 'delta-risk-policy.js'),
  ]);
  const contractModule = requireFromCandidates([
    path.join(rootPath, 'dist', 'services', 'closure-contract-v1.js'),
    path.join(rootPath, 'dist', 'src', 'services', 'closure-contract-v1.js'),
  ]);

  if (
    !plannerModule ||
    typeof plannerModule.planDeltaClosureV1 !== 'function' ||
    !policyModule ||
    !policyModule.DEFAULT_RISK_POLICY_V1 ||
    !contractModule ||
    typeof contractModule.buildClosureContractV1 !== 'function' ||
    typeof contractModule.stableStringify !== 'function'
  ) {
    throw new Error('unavailable');
  }

  return {
    planDeltaClosureV1: plannerModule.planDeltaClosureV1,
    policy: policyModule.DEFAULT_RISK_POLICY_V1,
    buildClosureContractV1: contractModule.buildClosureContractV1,
    stableStringify: contractModule.stableStringify,
    assertJsonSafe: contractModule.assertJsonSafe,
  };
}

function makeBaseState() {
  return {
    facts: [{ key: 'fact.alpha', statement: 'alpha' }],
    decisions: [],
    constraints: [],
    risks: [],
    assumptions: [],
  };
}

function makeProposedDelta() {
  return {
    schemaVersion: 'sdiff-0.1',
    base: { revisionHash: 'closure-selftest-base' },
    target: { revisionHash: 'closure-selftest-target' },
    facts: { added: [], removed: [], modified: [] },
    decisions: {
      added: [],
      removed: [],
      modified: [
        {
          key: 'decision.missing',
          before: null,
          after: { key: 'decision.missing', answer: 'accept' },
          changes: [{ path: 'answer', op: 'set', after: 'accept' }],
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

function buildApplyReport(modules) {
  const baseState = makeBaseState();
  const proposedDelta = makeProposedDelta();
  const plan = modules.planDeltaClosureV1({
    baseState,
    proposedDelta,
    mode: 'strict',
    policy: modules.policy,
  });
  const contractV1 = modules.buildClosureContractV1({
    proposedDelta,
    acceptedDelta: plan.acceptedDelta,
    rejected: plan.rejected,
    suggestions: plan.suggestions,
    diagnostics: plan.diagnostics,
  });
  const transition = applyDelta(baseState, plan.acceptedDelta, { mode: 'best_effort' });
  const postApplyConflicts = detectConflicts(transition.nextState);
  return {
    applyReport: {
      llmDelta: {
        closure: {
          contractV1,
        },
      },
    },
    postApplyConflicts,
  };
}

function main() {
  try {
    const modules = loadModules();
    const runA = buildApplyReport(modules);
    const runB = buildApplyReport(modules);
    const contractA = runA.applyReport.llmDelta.closure.contractV1;
    const contractB = runB.applyReport.llmDelta.closure.contractV1;

    modules.assertJsonSafe(contractA);

    const ok =
      contractA &&
      contractA.schema === 'closure-contract-1' &&
      isHex64(contractA.accepted.acceptedHash) &&
      isHex64(contractA.accepted.proposedHash) &&
      modules.stableStringify(contractA) === modules.stableStringify(contractB) &&
      contractA.diagnostics.closureViolationFlag === false &&
      Array.isArray(runA.postApplyConflicts) &&
      runA.postApplyConflicts.length === 0;

    process.stdout.write(ok ? 'CLOSURE_SELFTEST_OK\n' : 'CLOSURE_SELFTEST_FAIL\n');
    process.exit(ok ? 0 : 1);
  } catch (_error) {
    process.stdout.write('CLOSURE_SELFTEST_FAIL\n');
    process.exit(1);
  }
}

main();
