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

function baselineRank(name) {
  const index = BASELINE_ORDER.indexOf(name);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function round6(value) {
  return Math.round(value * 1000000) / 1000000;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeBaseline(rawBaseline) {
  const baseline = asRecord(rawBaseline);
  const rawName = typeof baseline.name === 'string' ? baseline.name : 'UNKNOWN_BASELINE';
  const baselineKey = BASELINE_WHITELIST.has(rawName) ? rawName : 'UNKNOWN_BASELINE';
  const mode = typeof baseline.mode === 'string' ? baseline.mode : null;
  const baselineModeKey = mode || 'null';

  if (baselineKey === 'UNKNOWN_BASELINE') {
    return {
      name: 'UNKNOWN_BASELINE',
      mode,
      supported: false,
      reason: 'unsupported baseline',
      baselineKey,
      baselineModeKey,
    };
  }

  return {
    name: baselineKey,
    mode,
    supported: baseline.supported === true,
    reason: typeof baseline.reason === 'string' ? baseline.reason : null,
    baselineKey,
    baselineModeKey,
  };
}

function average(values) {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function parseResultsJsonl(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function evaluateResults(records) {
  const groups = new Map();

  for (const record of records) {
    const baseline = normalizeBaseline(record.baseline);
    const task = asRecord(record.task);
    const taskId = typeof task.taskId === 'string' ? task.taskId : '';
    const key = `${taskId}::${baseline.baselineKey}`;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ record, baseline });
  }

  const rows = [];

  for (const groupEntries of groups.values()) {
    const sortedEntries = [...groupEntries].sort((left, right) => left.record.task.rep - right.record.task.rep);
    const sortedRecords = sortedEntries.map((entry) => entry.record);
    const sample = sortedEntries[0];
    const supported = sample.baseline.supported === true;

    const hashes = supported
      ? [
          ...new Set(
            sortedRecords
              .map((record) => asRecord(asRecord(record).identity).stateHashAfter)
              .filter((value) => typeof value === 'string' && value.length > 0)
          ),
        ]
      : [];

    rows.push({
      taskId: asRecord(sample.record.task).taskId,
      category: asRecord(sample.record.task).category,
      baseline: {
        name: sample.baseline.name,
        mode: sample.baseline.mode,
        supported: sample.baseline.supported,
        reason: sample.baseline.reason,
      },
      baselineKey: sample.baseline.baselineKey,
      baselineModeKey: sample.baseline.baselineModeKey,
      repetitions: sortedRecords.length,
      replayPassRate: null,
      hashStabilityRate: supported ? (hashes.length === 1 ? 1 : 0) : null,
      avgConflictCount: supported
        ? round6(average(sortedRecords.map((record) => asRecord(asRecord(record).transition).conflictCount)))
        : null,
      avgPostApplyConflictCount: supported
        ? round6(average(sortedRecords.map((record) => asRecord(asRecord(record).transition).postApplyConflictCount)))
        : null,
      avgDistanceCountsSum: supported
        ? round6(average(sortedRecords.map((record) => asRecord(asRecord(record).drift).distanceCountsSum)))
        : null,
      equalsTargetRate: supported
        ? round6(average(sortedRecords.map((record) => (asRecord(asRecord(record).drift).equalsTargetHash ? 1 : 0))))
        : null,
      assertionPassRate: supported
        ? round6(average(sortedRecords.map((record) => (asRecord(asRecord(record).assertions).passed ? 1 : 0))))
        : null,
    });
  }

  rows.sort((left, right) => {
    return (
      compareStrings(left.taskId, right.taskId) ||
      baselineRank(left.baseline.name) - baselineRank(right.baseline.name) ||
      compareStrings(left.baselineModeKey || '', right.baselineModeKey || '')
    );
  });

  return {
    schema: 'bench-summary-1',
    experimentId: 'EVAL-1',
    generatedAt: null,
    baselineOrder: BASELINE_ORDER,
    rows,
  };
}

function formatMetric(value) {
  return value === null ? 'null' : String(value);
}

function renderSummaryMarkdown(summary) {
  const lines = [];
  lines.push('# Shadow Threads EVAL-1 Summary');
  lines.push('');
  lines.push('- Experiment: EVAL-1');
  lines.push('- GeneratedAt: null');
  lines.push('');

  const taskIds = [...new Set(summary.rows.map((row) => row.taskId))].sort(compareStrings);

  for (const taskId of taskIds) {
    const taskRows = summary.rows.filter((row) => row.taskId === taskId);
    if (taskRows.length === 0) continue;
    const category = taskRows[0].category;

    lines.push(`## ${taskId} (${category})`);
    lines.push('| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');

    const ordered = [...taskRows].sort((left, right) => {
      return (
        baselineRank(left.baseline.name) - baselineRank(right.baseline.name) ||
        compareStrings(left.baselineModeKey || '', right.baselineModeKey || '')
      );
    });

    for (const row of ordered) {
      lines.push(
        `| ${row.baseline.name} | ${row.baseline.mode || 'null'} | ${row.baseline.supported} | ${formatMetric(row.hashStabilityRate)} | ${formatMetric(row.avgConflictCount)} | ${formatMetric(row.avgPostApplyConflictCount)} | ${formatMetric(row.avgDistanceCountsSum)} | ${formatMetric(row.equalsTargetRate)} | ${formatMetric(row.assertionPassRate)} |`
      );
    }

    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function runEvaluation(resultsFile, summaryJsonFile, summaryMdFile) {
  const content = fs.existsSync(resultsFile) ? fs.readFileSync(resultsFile, 'utf8') : '';
  const records = parseResultsJsonl(content);
  const summary = evaluateResults(records);
  const markdown = renderSummaryMarkdown(summary);

  fs.mkdirSync(path.dirname(summaryJsonFile), { recursive: true });
  fs.writeFileSync(summaryJsonFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(summaryMdFile, markdown, 'utf8');

  return summary;
}

function main() {
  const root = path.resolve(__dirname, '../../..');
  const resultsFile = path.join(root, 'bench', 'out', 'results.jsonl');
  const summaryJsonFile = path.join(root, 'bench', 'out', 'summary.json');
  const summaryMdFile = path.join(root, 'bench', 'out', 'summary.md');
  const summary = runEvaluation(resultsFile, summaryJsonFile, summaryMdFile);
  process.stdout.write(`EVAL-1 evaluator summarized ${summary.rows.length} task/baseline rows\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  compareStrings,
  parseResultsJsonl,
  evaluateResults,
  renderSummaryMarkdown,
  runEvaluation,
};
