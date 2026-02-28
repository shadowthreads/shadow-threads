const fs = require('fs');
const path = require('path');

const ALPHA = 0.05;
const HIGHER_IS_BETTER = new Set(['equalsTargetRate', 'assertionPassRate']);
const LOWER_IS_BETTER = new Set(['conflictCount', 'postApplyConflictCount', 'distanceCountsSum']);
const C1_METRICS = ['equalsTargetRate', 'assertionPassRate', 'conflictCount', 'postApplyConflictCount', 'distanceCountsSum'];

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function inferCategoryFromTaskId(taskId) {
  if (typeof taskId !== 'string') return null;
  if (taskId.startsWith('t1_')) return 'T1';
  if (taskId.startsWith('t2_')) return 'T2';
  if (taskId.startsWith('t3_')) return 'T3';
  return null;
}

function resolveCategory(row) {
  const value = row.category;
  if (value === 'T1' || value === 'T2' || value === 'T3') return value;
  return inferCategoryFromTaskId(row.taskId);
}

function metricRate(metric) {
  const candidate = asRecord(metric).rate;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

function metricMean(metric) {
  const candidate = asRecord(metric).mean;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

function isSignificant(metric) {
  return (
    metric.statStatus === 'ok' &&
    typeof metric.qValue === 'number' &&
    Number.isFinite(metric.qValue) &&
    metric.qValue <= ALPHA
  );
}

function strictWorse(metricName, estimate) {
  if (typeof estimate !== 'number' || !Number.isFinite(estimate)) return false;
  if (HIGHER_IS_BETTER.has(metricName)) return estimate > 0;
  if (LOWER_IS_BETTER.has(metricName)) return estimate < 0;
  return false;
}

function evaluateC1(comparisons) {
  for (const entry of comparisons) {
    const row = asRecord(entry);
    if (row.comparison !== 'C1') continue;
    if (row.skipped === true) continue;
    if (row.lhs !== 'B1_CORE_BEST_EFFORT' || row.rhs !== 'B1_CORE_STRICT') continue;

    const category = resolveCategory(row);
    if (category !== 'T1' && category !== 'T2') continue;

    const metrics = asRecord(row.metrics);
    for (const metricName of C1_METRICS) {
      const metric = asRecord(metrics[metricName]);
      if (!isSignificant(metric)) continue;
      if (strictWorse(metricName, metric.estimate)) {
        return false;
      }
    }
  }

  return true;
}

function findBaseline(task, name) {
  const baselines = Array.isArray(task.baselines) ? task.baselines : [];
  return baselines.find((baseline) => asRecord(asRecord(baseline).baseline).name === name) || null;
}

function evaluateB4Hard(byTask) {
  const rows = Array.isArray(byTask) ? byTask : [];
  for (const row of rows) {
    const task = asRecord(row);
    if (resolveCategory(task) !== 'T3') continue;

    const b4 = findBaseline(task, 'B4_STRICT_RISK_CLOSURE');
    if (!b4) continue;
    if (asRecord(asRecord(b4).baseline).supported !== true) continue;

    const metrics = asRecord(asRecord(b4).metrics);
    const riskClosureViolationRate = metricRate(metrics.riskClosureViolationRate);
    const postApplyMean = metricMean(metrics.postApplyConflictCount);

    if (riskClosureViolationRate !== null && riskClosureViolationRate > 0) {
      return false;
    }
    if (postApplyMean !== null && postApplyMean > 0) {
      return false;
    }
  }

  return true;
}

function evaluateSuggestionCoverage(byTask) {
  const rows = Array.isArray(byTask) ? byTask : [];
  for (const row of rows) {
    const task = asRecord(row);
    if (resolveCategory(task) !== 'T3') continue;

    const b4 = findBaseline(task, 'B4_STRICT_RISK_CLOSURE');
    const b5 = findBaseline(task, 'B5_STRICT_CLOSURE_SUGGESTIONS');
    if (!b4 || !b5) continue;
    if (asRecord(asRecord(b4).baseline).supported !== true) continue;
    if (asRecord(asRecord(b5).baseline).supported !== true) continue;

    const b4Metrics = asRecord(asRecord(b4).metrics);
    const l3Rate = metricMean(b4Metrics.riskLevelL3Rate);
    if (l3Rate === null || l3Rate <= 0) {
      continue;
    }

    const b5Metrics = asRecord(asRecord(b5).metrics);
    const coverageRate = metricMean(b5Metrics.suggestionsCoverageRate);
    const blockedByResolutionRate = metricMean(b5Metrics.blockedByResolutionRate);

    if (coverageRate === null || coverageRate < 0.8) {
      return false;
    }
    if (blockedByResolutionRate === null || blockedByResolutionRate < 0.8) {
      return false;
    }
  }

  return true;
}

function evaluateGate(stats) {
  const comparisons = Array.isArray(stats.comparisons) ? stats.comparisons : [];
  const byTask = Array.isArray(stats.byTask) ? stats.byTask : [];
  return evaluateC1(comparisons) && evaluateB4Hard(byTask) && evaluateSuggestionCoverage(byTask);
}

function runGate(statsFile) {
  if (!fs.existsSync(statsFile)) {
    return false;
  }

  try {
    const content = fs.readFileSync(statsFile, 'utf8');
    const stats = JSON.parse(content);
    return evaluateGate(stats);
  } catch (_error) {
    return false;
  }
}

function main() {
  const root = path.resolve(__dirname, '../../..');
  const statsFile = path.join(root, 'bench', 'out', 'eval2.stats.json');
  const passed = runGate(statsFile);

  if (passed) {
    process.stdout.write('EVAL2_GATE_PASS\n');
    process.exit(0);
  }

  process.stdout.write('EVAL2_GATE_FAIL\n');
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  strictWorse,
  evaluateGate,
  runGate,
};
