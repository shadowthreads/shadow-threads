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
    const suggestionModule = requireFromCandidates([
      path.join(root, 'dist', 'services', 'delta-suggestion-engine.js'),
      path.join(root, 'dist', 'src', 'services', 'delta-suggestion-engine.js'),
    ]);
    const policyModule = requireFromCandidates([
      path.join(root, 'dist', 'services', 'delta-risk-policy.js'),
      path.join(root, 'dist', 'src', 'services', 'delta-risk-policy.js'),
    ]);

    if (
      !suggestionModule ||
      typeof suggestionModule.buildClosureSuggestionsV1 !== 'function' ||
      !policyModule ||
      !policyModule.DEFAULT_RISK_POLICY_V1
    ) {
      process.stdout.write('SUGGESTION_SELFTEST_FAIL\n');
      process.exit(1);
    }

    const input = {
      rejected: [
        {
          domain: 'decisions',
          key: 'decision.alpha',
          path: 'answer',
          op: 'modify',
          reasonCode: 'DEPENDENCY_BLOCKED',
          blockedBy: [{ domain: 'facts', key: 'fact.alpha', path: null }],
          riskLevel: 'L3',
        },
      ],
      policy: policyModule.DEFAULT_RISK_POLICY_V1,
      limits: { maxSuggestions: 64 },
    };

    const resultA = suggestionModule.buildClosureSuggestionsV1(input);
    const resultB = suggestionModule.buildClosureSuggestionsV1(input);

    const same = stableStringify(resultA) === stableStringify(resultB);
    const suggestions = Array.isArray(resultA.suggestions) ? resultA.suggestions : [];
    const ordered = suggestions.map((entry) => entry.kind).join(',') === 'ADD_MISSING_DEP,PROMOTE_TO_L3_REVIEW';
    const messagesExact =
      suggestions.length === 2 &&
      suggestions[0].message === 'Add missing dependency' &&
      suggestions[1].message === 'Requires L3 review';

    if (!same || !ordered || !messagesExact) {
      process.stdout.write('SUGGESTION_SELFTEST_FAIL\n');
      process.exit(1);
    }

    process.stdout.write('SUGGESTION_SELFTEST_OK\n');
    process.exit(0);
  } catch (_error) {
    process.stdout.write('SUGGESTION_SELFTEST_FAIL\n');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
