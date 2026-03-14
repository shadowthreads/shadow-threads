const fs = require('fs');
const path = require('path');

const MESSAGE_WHITELIST = new Set([
  'Add missing dependency',
  'Request human confirm',
  'Requires L3 review',
  'Split patch',
  'Retry with context',
]);

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
  const rootPath = path.resolve(__dirname, '../../..');
  const suggestionModule = requireFromCandidates([
    path.join(rootPath, 'dist', 'services', 'delta-suggestion-engine.js'),
    path.join(rootPath, 'dist', 'src', 'services', 'delta-suggestion-engine.js'),
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
    !suggestionModule ||
    typeof suggestionModule.buildClosureSuggestionsV1 !== 'function' ||
    !policyModule ||
    !policyModule.DEFAULT_RISK_POLICY_V1 ||
    !contractModule ||
    typeof contractModule.assertJsonSafe !== 'function' ||
    typeof contractModule.stableStringify !== 'function'
  ) {
    throw new Error('unavailable');
  }

  return {
    buildClosureSuggestionsV1: suggestionModule.buildClosureSuggestionsV1,
    policy: policyModule.DEFAULT_RISK_POLICY_V1,
    assertJsonSafe: contractModule.assertJsonSafe,
    stableStringify: contractModule.stableStringify,
  };
}

function makeInput(policy) {
  return {
    rejected: [
      {
        domain: 'decisions',
        key: 'decision.conflict',
        path: 'answer',
        op: 'modify',
        reasonCode: 'CONFLICT',
        blockedBy: null,
        riskLevel: 'L2',
      },
      {
        domain: 'facts',
        key: 'fact.alpha',
        path: null,
        op: 'add',
        reasonCode: 'DEPENDENCY_BLOCKED',
        blockedBy: [{ domain: 'facts', key: 'fact.alpha', path: null }],
        riskLevel: 'L3',
      },
    ],
    policy,
    limits: { maxSuggestions: 64 },
  };
}

function main() {
  try {
    const modules = loadModules();
    const input = makeInput(modules.policy);
    const resultA = modules.buildClosureSuggestionsV1(input);
    const resultB = modules.buildClosureSuggestionsV1(input);

    modules.assertJsonSafe(resultA.suggestions);

    const messagesValid = resultA.suggestions.every(
      (entry) => entry && entry.schema === 'closure-suggestion-1' && MESSAGE_WHITELIST.has(entry.message)
    );
    const deterministic = modules.stableStringify(resultA.suggestions) === modules.stableStringify(resultB.suggestions);

    const ok = messagesValid && deterministic;
    process.stdout.write(ok ? 'SUGGESTION_SELFTEST_OK\n' : 'SUGGESTION_SELFTEST_FAIL\n');
    process.exit(ok ? 0 : 1);
  } catch (_error) {
    process.stdout.write('SUGGESTION_SELFTEST_FAIL\n');
    process.exit(1);
  }
}

main();
