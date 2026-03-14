const fs = require('fs');
const path = require('path');

const BASELINE_ORDER = [
  'B1_CORE_BEST_EFFORT',
  'B1_CORE_STRICT',
  'B1_PIPELINE',
  'B2_LLM_DELTA_BEST_EFFORT',
  'B2_LLM_DELTA_STRICT',
  'B3_STRICT_CLOSURE',
  'B4_STRICT_RISK_CLOSURE',
  'B5_STRICT_CLOSURE_SUGGESTIONS',
];
const BASELINE_WHITELIST = new Set(BASELINE_ORDER);

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeBaseline(rawBaseline) {
  const baseline = asRecord(rawBaseline);
  const rawName = typeof baseline.name === 'string' ? baseline.name : 'UNKNOWN_BASELINE';
  const baselineName = BASELINE_WHITELIST.has(rawName) ? rawName : 'UNKNOWN_BASELINE';
  const mode = typeof baseline.mode === 'string' ? baseline.mode : null;

  if (baselineName === 'UNKNOWN_BASELINE') {
    return {
      name: 'UNKNOWN_BASELINE',
      mode,
      supported: false,
      reason: 'unsupported baseline',
      baselineModeKey: mode || 'null',
    };
  }

  return {
    name: baselineName,
    mode,
    supported: baseline.supported === true,
    reason: typeof baseline.reason === 'string' ? baseline.reason : null,
    baselineModeKey: mode || 'null',
  };
}

function toSortedObject(counter) {
  const keys = Object.keys(counter).sort(compareStrings);
  const output = {};
  for (const key of keys) {
    output[key] = counter[key];
  }
  return output;
}

function parseResults(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function buildEvidence(records) {
  const baselineNameCounts = {};
  const baselineModeCounts = {};
  let exampleBaseline = null;

  for (const record of records) {
    const normalized = normalizeBaseline(asRecord(record).baseline);

    baselineNameCounts[normalized.name] = (baselineNameCounts[normalized.name] || 0) + 1;
    baselineModeCounts[normalized.baselineModeKey] = (baselineModeCounts[normalized.baselineModeKey] || 0) + 1;

    if (exampleBaseline === null) {
      exampleBaseline = {
        name: normalized.name,
        mode: normalized.mode,
        supported: normalized.supported,
        reason: normalized.reason,
      };
    }
  }

  return {
    baselineNames: toSortedObject(baselineNameCounts),
    baselineModes: toSortedObject(baselineModeCounts),
    exampleBaseline,
  };
}

function runEvidence(resultsFile) {
  const content = fs.existsSync(resultsFile) ? fs.readFileSync(resultsFile, 'utf8') : '';
  const records = parseResults(content);
  return buildEvidence(records);
}

function main() {
  const root = path.resolve(__dirname, '../../..');
  const resultsFile = path.join(root, 'bench', 'out', 'results.jsonl');
  const evidence = runEvidence(resultsFile);

  process.stdout.write('BASELINE_EVIDENCE\n');
  process.stdout.write(`baseline_names: ${JSON.stringify(evidence.baselineNames)}\n`);
  process.stdout.write(`baseline_modes: ${JSON.stringify(evidence.baselineModes)}\n`);
  process.stdout.write(`example_row_baseline: ${JSON.stringify(evidence.exampleBaseline)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  compareStrings,
  normalizeBaseline,
  buildEvidence,
  runEvidence,
};
