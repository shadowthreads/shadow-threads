const fs = require('fs');
const path = require('path');

const COMPARISON_ORDER = ['C1', 'C4', 'C5'];
const METRICS_BY_COMPARISON = {
  C1: ['assertionPassRate', 'conflictCount', 'distanceCountsSum', 'equalsTargetRate', 'postApplyConflictCount'],
  C4: ['rollbackRate'],
  C5: ['deltaRejectionRate'],
};

const HIGHER_IS_BETTER = new Set(['equalsTargetRate', 'assertionPassRate', 'rollbackRate', 'deltaRejectionRate']);
const LOWER_IS_BETTER = new Set(['conflictCount', 'postApplyConflictCount', 'distanceCountsSum']);

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getComparisonRank(value) {
  const index = COMPARISON_ORDER.indexOf(value);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function effectDirection(metricKey, estimate) {
  if (typeof estimate !== 'number' || !Number.isFinite(estimate)) return null;
  if (estimate === 0) return 'equal';

  if (HIGHER_IS_BETTER.has(metricKey)) {
    return estimate > 0 ? 'strict_worse' : 'strict_better';
  }

  if (LOWER_IS_BETTER.has(metricKey)) {
    return estimate > 0 ? 'strict_better' : 'strict_worse';
  }

  return null;
}

function collectRows(stats) {
  if (Array.isArray(stats.comparisons) && stats.comparisons.length > 0) {
    return stats.comparisons.map((entry) => {
      const row = asRecord(entry);
      return {
        comparison: typeof row.comparison === 'string' ? row.comparison : '',
        taskId: typeof row.taskId === 'string' ? row.taskId : '*GLOBAL*',
        category: typeof row.category === 'string' ? row.category : null,
        metrics: asRecord(row.metrics),
      };
    });
  }

  if (Array.isArray(stats.globalComparisons) && stats.globalComparisons.length > 0) {
    return stats.globalComparisons.map((entry) => {
      const row = asRecord(entry);
      return {
        comparison: typeof row.comparison === 'string' ? row.comparison : '',
        taskId: '*GLOBAL*',
        category: null,
        metrics: asRecord(row.metrics),
      };
    });
  }

  return [];
}

function collectDiagnostics(stats) {
  const rows = collectRows(stats);
  const out = [];

  for (const row of rows) {
    if (!COMPARISON_ORDER.includes(row.comparison)) continue;
    const metricKeys = METRICS_BY_COMPARISON[row.comparison];

    for (const metricKey of metricKeys) {
      const metric = asRecord(row.metrics[metricKey]);
      const status = typeof metric.statStatus === 'string' ? metric.statStatus : 'null';
      const q = Object.prototype.hasOwnProperty.call(metric, 'qValue') ? metric.qValue : null;
      const reason = Object.prototype.hasOwnProperty.call(metric, 'reason') ? metric.reason : null;

      out.push({
        comparison: row.comparison,
        taskId: row.taskId,
        metricKey,
        status,
        q,
        effect: effectDirection(metricKey, metric.estimate),
        reason,
      });
    }
  }

  out.sort((left, right) => {
    return (
      getComparisonRank(left.comparison) - getComparisonRank(right.comparison) ||
      compareStrings(left.taskId, right.taskId) ||
      compareStrings(left.metricKey, right.metricKey)
    );
  });

  return out;
}

function runDiagnose(statsFile) {
  if (!fs.existsSync(statsFile)) {
    process.stdout.write('DIAGNOSE_INPUT_MISSING\n');
    process.exit(1);
  }

  let stats;
  try {
    stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
  } catch (_error) {
    process.stdout.write('DIAGNOSE_INPUT_INVALID\n');
    process.exit(1);
  }

  const rows = collectDiagnostics(stats);
  process.stdout.write('DIAGNOSE_BEGIN\n');
  for (const row of rows) {
    process.stdout.write(
      `DIAG comparison=${row.comparison} task=${row.taskId} metric=${row.metricKey} status=${row.status} q=${row.q === null ? 'null' : row.q} effect=${row.effect === null ? 'null' : row.effect} reason=${row.reason === null ? 'null' : row.reason}\n`
    );
  }
  process.stdout.write('DIAGNOSE_END\n');
}

function main() {
  const root = path.resolve(__dirname, '../../..');
  const statsFile = path.join(root, 'bench', 'out', 'eval2.stats.json');
  runDiagnose(statsFile);
}

if (require.main === module) {
  main();
}

module.exports = {
  compareStrings,
  effectDirection,
  collectDiagnostics,
  runDiagnose,
};
