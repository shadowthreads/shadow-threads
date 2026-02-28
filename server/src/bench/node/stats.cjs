const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DOMAIN_ORDER = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];
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
const COMPARISON_ORDER = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
const COMPARISON_CONFIG = {
  C1: { lhs: 'B1_CORE_BEST_EFFORT', rhs: 'B1_CORE_STRICT', scope: 'all' },
  C2: { lhs: 'B1_CORE_BEST_EFFORT', rhs: 'B1_PIPELINE', scope: 'all' },
  C3: { lhs: 'B1_CORE_STRICT', rhs: 'B1_PIPELINE', scope: 'all' },
  C4: { lhs: 'B1_CORE_BEST_EFFORT', rhs: 'B1_CORE_STRICT', scope: 't3' },
  C5: { lhs: 'B2_LLM_DELTA_BEST_EFFORT', rhs: 'B2_LLM_DELTA_STRICT', scope: 't3' },
  C6: { lhs: 'B3_STRICT_CLOSURE', rhs: 'B4_STRICT_RISK_CLOSURE', scope: 't3' },
  C7: { lhs: 'B3_STRICT_CLOSURE', rhs: 'B5_STRICT_CLOSURE_SUGGESTIONS', scope: 't3' },
};
const METRIC_ORDER = [
  'equalsTargetRate',
  'assertionPassRate',
  'conflictCount',
  'postApplyConflictCount',
  'distanceCountsSum',
  'rollbackRate',
  'deltaRejectionRate',
  'domainRollbackRate',
  'closureViolationRate',
  'maxClosureSizeRatio',
  'blockedByRate',
  'rejectedCount',
  'riskClosureViolationRate',
  'riskClosureRejectedCountMean',
  'riskClosureBlockedByRateMean',
  'riskClosureMaxClosureSizeRatioMean',
  'riskLevelL3Rate',
  'suggestionsCoverageRate',
  'blockedByResolutionRate',
  'suggestionCountMean',
];
const ALPHA = 0.05;
const Z95 = 1.959963984540054;

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function round6(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1000000) / 1000000;
}

function parseResultsJsonl(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function parseSummary(content) {
  if (!content.trim()) return { rows: [] };
  const parsed = JSON.parse(content);
  return { rows: asArray(parsed.rows) };
}

function normalizeBaseline(rawBaseline) {
  const baseline = asRecord(rawBaseline);
  const rawName = typeof baseline.name === 'string' ? baseline.name : 'UNKNOWN_BASELINE';
  const baselineKey = BASELINE_WHITELIST.has(rawName) ? rawName : 'UNKNOWN_BASELINE';
  const mode = typeof baseline.mode === 'string' ? baseline.mode : null;

  if (baselineKey === 'UNKNOWN_BASELINE') {
    return {
      name: 'UNKNOWN_BASELINE',
      mode,
      baselineKey: 'UNKNOWN_BASELINE',
      baselineModeKey: mode || 'null',
      supported: false,
      reason: 'unsupported baseline',
    };
  }

  return {
    name: baselineKey,
    mode,
    baselineKey,
    baselineModeKey: mode || 'null',
    supported: baseline.supported === true,
    reason: typeof baseline.reason === 'string' ? baseline.reason : null,
  };
}

function mean(values) {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function sampleVariance(values, meanValue) {
  if (values.length < 2) return null;
  let total = 0;
  for (const value of values) {
    const diff = value - meanValue;
    total += diff * diff;
  }
  return total / (values.length - 1);
}

function tCritical95(dfRaw) {
  if (!Number.isFinite(dfRaw) || dfRaw <= 0) return null;
  const df = Math.max(1, Math.floor(dfRaw));
  const table = {
    1: 12.706205,
    2: 4.302653,
    3: 3.182446,
    4: 2.776445,
    5: 2.570582,
    6: 2.446912,
    7: 2.364624,
    8: 2.306004,
    9: 2.262157,
    10: 2.228139,
    11: 2.200985,
    12: 2.178813,
    13: 2.160369,
    14: 2.144787,
    15: 2.13145,
    16: 2.119905,
    17: 2.109816,
    18: 2.100922,
    19: 2.093024,
    20: 2.085963,
    21: 2.079614,
    22: 2.073873,
    23: 2.068658,
    24: 2.063899,
    25: 2.059539,
    26: 2.055529,
    27: 2.051831,
    28: 2.048407,
    29: 2.04523,
    30: 2.042272,
    40: 2.021075,
    60: 2.000298,
    120: 1.97993,
  };
  if (table[df]) return table[df];
  if (df > 120) return 1.959964;
  if (df > 60) {
    const ratio = (df - 60) / 60;
    return table[60] + (table[120] - table[60]) * ratio;
  }
  if (df > 40) {
    const ratio = (df - 40) / 20;
    return table[40] + (table[60] - table[40]) * ratio;
  }
  if (df > 30) {
    const ratio = (df - 30) / 10;
    return table[30] + (table[40] - table[30]) * ratio;
  }
  return table[30];
}

function meanWithCI(values) {
  if (values.length === 0) {
    return {
      n: 0,
      mean: null,
      ci: { low: null, high: null },
    };
  }

  const meanValue = mean(values);
  const variance = sampleVariance(values, meanValue);

  if (variance === null) {
    return {
      n: values.length,
      mean: round6(meanValue),
      ci: { low: null, high: null },
    };
  }

  const critical = tCritical95(values.length - 1);
  if (critical === null) {
    return {
      n: values.length,
      mean: round6(meanValue),
      ci: { low: null, high: null },
    };
  }

  const margin = critical * Math.sqrt(variance / values.length);
  return {
    n: values.length,
    mean: round6(meanValue),
    ci: {
      low: round6(meanValue - margin),
      high: round6(meanValue + margin),
    },
  };
}

function wilsonCI(successes, total) {
  if (!Number.isFinite(successes) || !Number.isFinite(total) || total <= 0) {
    return { low: null, high: null };
  }

  const p = successes / total;
  const denominator = 1 + (Z95 * Z95) / total;
  const center = (p + (Z95 * Z95) / (2 * total)) / denominator;
  const margin =
    (Z95 * Math.sqrt((p * (1 - p) + (Z95 * Z95) / (4 * total)) / total)) /
    denominator;

  return {
    low: round6(Math.max(0, center - margin)),
    high: round6(Math.min(1, center + margin)),
  };
}

function proportionWithCI(booleanValues) {
  let k = 0;
  for (const value of booleanValues) {
    if (value) k += 1;
  }
  const n = booleanValues.length;
  return {
    n,
    k,
    rate: n === 0 ? null : round6(k / n),
    ci: wilsonCI(k, n),
  };
}

function logFactorialFactory(maxN) {
  const cache = new Array(maxN + 1).fill(0);
  for (let i = 2; i <= maxN; i += 1) {
    cache[i] = cache[i - 1] + Math.log(i);
  }
  return cache;
}

function logChoose(logFactorial, n, k) {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  return logFactorial[n] - logFactorial[k] - logFactorial[n - k];
}

function fisherExactTwoSided(k1, n1, k2, n2) {
  if (n1 <= 0 || n2 <= 0) return null;

  const totalSuccess = k1 + k2;
  const totalN = n1 + n2;
  const minA = Math.max(0, totalSuccess - n2);
  const maxA = Math.min(n1, totalSuccess);

  const logFactorial = logFactorialFactory(totalN);
  const observedLogP =
    logChoose(logFactorial, n1, k1) +
    logChoose(logFactorial, n2, k2) -
    logChoose(logFactorial, totalN, totalSuccess);

  let pValue = 0;
  const epsilon = 1e-12;

  for (let a = minA; a <= maxA; a += 1) {
    const b = totalSuccess - a;
    const logP =
      logChoose(logFactorial, n1, a) +
      logChoose(logFactorial, n2, b) -
      logChoose(logFactorial, totalN, totalSuccess);
    if (logP <= observedLogP + epsilon) {
      pValue += Math.exp(logP);
    }
  }

  if (pValue > 1) pValue = 1;
  return round6(pValue);
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * absX);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX));
  return sign * y;
}

function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function mannWhitneyUTwoSided(valuesA, valuesB) {
  const n1 = valuesA.length;
  const n2 = valuesB.length;
  if (n1 === 0 || n2 === 0) return null;

  const combined = [];
  for (const value of valuesA) combined.push({ value, group: 0 });
  for (const value of valuesB) combined.push({ value, group: 1 });

  combined.sort((left, right) => {
    if (left.value < right.value) return -1;
    if (left.value > right.value) return 1;
    return left.group - right.group;
  });

  const ranks = new Array(combined.length);
  let tieSum = 0;
  let index = 0;

  while (index < combined.length) {
    let end = index + 1;
    while (end < combined.length && combined[end].value === combined[index].value) {
      end += 1;
    }

    const averageRank = (index + 1 + end) / 2;
    for (let i = index; i < end; i += 1) {
      ranks[i] = averageRank;
    }

    const tieSize = end - index;
    if (tieSize > 1) {
      tieSum += tieSize * tieSize * tieSize - tieSize;
    }

    index = end;
  }

  let rankSumA = 0;
  for (let i = 0; i < combined.length; i += 1) {
    if (combined[i].group === 0) {
      rankSumA += ranks[i];
    }
  }

  const u1 = rankSumA - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const u = Math.min(u1, u2);
  const n = n1 + n2;
  const correction = n > 1 ? tieSum / (n * (n - 1)) : 0;
  const variance = (n1 * n2 * (n + 1 - correction)) / 12;

  if (variance <= 0) {
    return round6(u === (n1 * n2) / 2 ? 1 : 0);
  }

  const meanU = (n1 * n2) / 2;
  const z = (u - meanU) / Math.sqrt(variance);
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return round6(Math.max(0, Math.min(1, pValue)));
}

function cliffsDelta(valuesA, valuesB) {
  const n1 = valuesA.length;
  const n2 = valuesB.length;
  if (n1 === 0 || n2 === 0) return null;

  let greater = 0;
  let less = 0;
  for (const left of valuesA) {
    for (const right of valuesB) {
      if (left > right) greater += 1;
      else if (left < right) less += 1;
    }
  }

  return round6((greater - less) / (n1 * n2));
}

function cohenD(valuesA, valuesB) {
  if (valuesA.length < 2 || valuesB.length < 2) return null;

  const meanA = mean(valuesA);
  const meanB = mean(valuesB);
  const varA = sampleVariance(valuesA, meanA);
  const varB = sampleVariance(valuesB, meanB);

  if (varA === null || varB === null) return null;

  const pooledNumerator = (valuesA.length - 1) * varA + (valuesB.length - 1) * varB;
  const pooledDenominator = valuesA.length + valuesB.length - 2;
  if (pooledDenominator <= 0) return null;

  const pooledVar = pooledNumerator / pooledDenominator;
  if (pooledVar <= 0) return null;

  return round6((meanA - meanB) / Math.sqrt(pooledVar));
}

function differenceCIForRates(k1, n1, k2, n2) {
  if (n1 <= 0 || n2 <= 0) {
    return { low: null, high: null };
  }

  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const diff = p1 - p2;
  const se = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  const margin = Z95 * se;
  return {
    low: round6(diff - margin),
    high: round6(diff + margin),
  };
}

function differenceCIForMeans(valuesA, valuesB) {
  if (valuesA.length < 2 || valuesB.length < 2) {
    return { low: null, high: null };
  }

  const meanA = mean(valuesA);
  const meanB = mean(valuesB);
  const varA = sampleVariance(valuesA, meanA);
  const varB = sampleVariance(valuesB, meanB);

  if (varA === null || varB === null) {
    return { low: null, high: null };
  }

  const n1 = valuesA.length;
  const n2 = valuesB.length;
  const se2 = varA / n1 + varB / n2;
  if (se2 <= 0) {
    return { low: null, high: null };
  }

  const numerator = se2 * se2;
  const denominator =
    (varA * varA) / (n1 * n1 * (n1 - 1)) +
    (varB * varB) / (n2 * n2 * (n2 - 1));
  const df = denominator > 0 ? numerator / denominator : Math.min(n1, n2) - 1;

  const critical = tCritical95(df);
  if (critical === null) {
    return { low: null, high: null };
  }

  const diff = meanA - meanB;
  const margin = critical * Math.sqrt(se2);
  return {
    low: round6(diff - margin),
    high: round6(diff + margin),
  };
}

function baseEffect() {
  return {
    riskDifference: null,
    riskRatio: null,
    cohenD: null,
    cliffsDelta: null,
  };
}

function skippedMetric(reason) {
  return {
    statStatus: 'skipped',
    reason,
    lhs: null,
    rhs: null,
    estimate: null,
    ci: { low: null, high: null },
    pValue: null,
    qValue: null,
    effect: baseEffect(),
  };
}

function insufficientMetric(lhs, rhs) {
  return {
    statStatus: 'insufficient_samples',
    reason: 'insufficient samples',
    lhs,
    rhs,
    estimate: null,
    ci: { low: null, high: null },
    pValue: null,
    qValue: null,
    effect: baseEffect(),
  };
}

function okMetric(lhs, rhs, estimate, ci, pValue, effect) {
  const normalizedEffect = baseEffect();
  normalizedEffect.riskDifference = effect.riskDifference;
  normalizedEffect.riskRatio = effect.riskRatio;
  normalizedEffect.cohenD = effect.cohenD;
  normalizedEffect.cliffsDelta = effect.cliffsDelta;

  return {
    statStatus: 'ok',
    reason: null,
    lhs,
    rhs,
    estimate,
    ci,
    pValue,
    qValue: null,
    effect: normalizedEffect,
  };
}

function applyBenjaminiHochberg(items) {
  const eligible = items
    .filter((item) => item.pValue !== null)
    .sort((left, right) => {
      if (left.pValue < right.pValue) return -1;
      if (left.pValue > right.pValue) return 1;
      return compareStrings(left.id, right.id);
    });

  const total = eligible.length;
  if (total === 0) return;

  let running = 1;
  for (let i = total - 1; i >= 0; i -= 1) {
    const rank = i + 1;
    const adjusted = Math.min(1, (eligible[i].pValue * total) / rank);
    running = Math.min(running, adjusted);
    eligible[i].setQValue(round6(running));
  }
}

function buildTaskGroups(records) {
  const tasks = new Map();

  for (const record of records) {
    const task = asRecord(record.task);
    const taskId = typeof task.taskId === 'string' ? task.taskId : '';
    const category = task.category === 'T1' || task.category === 'T2' || task.category === 'T3' ? task.category : 'T1';
    const baseline = normalizeBaseline(record.baseline);

    if (!tasks.has(taskId)) {
      tasks.set(taskId, {
        taskId,
        category,
        baselines: new Map(),
      });
    }

    const taskGroup = tasks.get(taskId);
    if (!taskGroup.baselines.has(baseline.baselineKey)) {
      taskGroup.baselines.set(baseline.baselineKey, {
        baseline,
        records: [],
      });
    }

    taskGroup.baselines.get(baseline.baselineKey).records.push(record);
  }

  return tasks;
}

function toBooleanArray(records, eligibility, selector) {
  const values = [];
  for (const record of records) {
    if (eligibility(record)) {
      values.push(selector(record) === true);
    }
  }
  return values;
}

function toNumberArray(records, eligibility, selector) {
  const values = [];
  for (const record of records) {
    if (!eligibility(record)) continue;
    const value = selector(record);
    if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
  }
  return values;
}

function buildRateMetric(lhsRecords, rhsRecords, eligibility, selector) {
  const lhsValues = toBooleanArray(lhsRecords, eligibility, selector);
  const rhsValues = toBooleanArray(rhsRecords, eligibility, selector);
  const lhs = proportionWithCI(lhsValues);
  const rhs = proportionWithCI(rhsValues);

  if (lhs.n === 0 || rhs.n === 0) {
    return insufficientMetric(lhs, rhs);
  }

  const estimate = round6(lhs.rate - rhs.rate);
  const ci = differenceCIForRates(lhs.k, lhs.n, rhs.k, rhs.n);
  const pValue = fisherExactTwoSided(lhs.k, lhs.n, rhs.k, rhs.n);

  if (pValue === null) {
    return insufficientMetric(lhs, rhs);
  }

  return okMetric(lhs, rhs, estimate, ci, pValue, {
    riskDifference: estimate,
    riskRatio: rhs.rate === 0 ? null : round6(lhs.rate / rhs.rate),
    cohenD: null,
    cliffsDelta: null,
  });
}

function buildMeanMetric(lhsRecords, rhsRecords, eligibility, selector) {
  const lhsValues = toNumberArray(lhsRecords, eligibility, selector);
  const rhsValues = toNumberArray(rhsRecords, eligibility, selector);
  const lhs = meanWithCI(lhsValues);
  const rhs = meanWithCI(rhsValues);

  if (lhs.n === 0 || rhs.n === 0) {
    return insufficientMetric(lhs, rhs);
  }

  const estimate = lhs.mean === null || rhs.mean === null ? null : round6(lhs.mean - rhs.mean);
  const ci = differenceCIForMeans(lhsValues, rhsValues);
  const pValue = mannWhitneyUTwoSided(lhsValues, rhsValues);

  if (pValue === null) {
    return insufficientMetric(lhs, rhs);
  }

  return okMetric(lhs, rhs, estimate, ci, pValue, {
    riskDifference: null,
    riskRatio: null,
    cohenD: cohenD(lhsValues, rhsValues),
    cliffsDelta: cliffsDelta(lhsValues, rhsValues),
  });
}

function aggregateBaseline(records, baseline) {
  if (!baseline.supported) {
    return {
      baseline: {
        name: baseline.name,
        mode: baseline.mode,
        supported: false,
        reason: baseline.reason,
      },
      baselineKey: baseline.baselineKey,
      baselineModeKey: baseline.baselineModeKey,
      repetitions: records.length,
      metrics: {
        hashStabilityRate: null,
        equalsTargetRate: null,
        assertionPassRate: null,
        conflictCount: null,
        postApplyConflictCount: null,
        distanceCountsSum: null,
        rollbackRate: null,
        deltaRejectionRate: null,
        domainRollbackRate: null,
        closureViolationRate: null,
        maxClosureSizeRatio: null,
        blockedByRate: null,
        rejectedCount: null,
        riskClosureViolationRate: null,
        riskClosureRejectedCountMean: null,
        riskClosureBlockedByRateMean: null,
        riskClosureMaxClosureSizeRatioMean: null,
        riskLevelL3Rate: null,
        suggestionsCoverageRate: null,
        blockedByResolutionRate: null,
        suggestionCountMean: null,
      },
    };
  }

  const hashes = [];
  for (const record of records) {
    const hash = asRecord(asRecord(record).identity).stateHashAfter;
    if (typeof hash === 'string' && hash.length > 0 && !hashes.includes(hash)) {
      hashes.push(hash);
    }
  }

  const conflictEligibility = (record) => {
    const count = asRecord(asRecord(record).transition).conflictCount;
    return typeof count === 'number' && count > 0;
  };

  const llmEligibility = (record) => {
    const value = asRecord(asRecord(record).transition).deltaRejectedIndicator;
    return value === 0 || value === 1;
  };

  const closureEligibility = (record) => {
    const value = asRecord(asRecord(record).transition).closureViolationFlag;
    return value === 0 || value === 1;
  };

  return {
    baseline: {
      name: baseline.name,
      mode: baseline.mode,
      supported: true,
      reason: null,
    },
    baselineKey: baseline.baselineKey,
    baselineModeKey: baseline.baselineModeKey,
    repetitions: records.length,
    metrics: {
      hashStabilityRate: records.length > 0 && hashes.length === 1 ? 1 : 0,
      equalsTargetRate: proportionWithCI(
        toBooleanArray(records, () => true, (record) => asRecord(asRecord(record).drift).equalsTargetHash)
      ),
      assertionPassRate: proportionWithCI(
        toBooleanArray(records, () => true, (record) => asRecord(asRecord(record).assertions).passed)
      ),
      conflictCount: meanWithCI(
        toNumberArray(records, () => true, (record) => asRecord(asRecord(record).transition).conflictCount)
      ),
      postApplyConflictCount: meanWithCI(
        toNumberArray(records, () => true, (record) => asRecord(asRecord(record).transition).postApplyConflictCount)
      ),
      distanceCountsSum: meanWithCI(
        toNumberArray(records, () => true, (record) => asRecord(asRecord(record).drift).distanceCountsSum)
      ),
      rollbackRate: proportionWithCI(
        toBooleanArray(records, conflictEligibility, (record) => asRecord(asRecord(record).transition).rollbackIndicator === 1)
      ),
      deltaRejectionRate: proportionWithCI(
        toBooleanArray(records, llmEligibility, (record) => asRecord(asRecord(record).transition).deltaRejectedIndicator === 1)
      ),
      domainRollbackRate: meanWithCI(
        toNumberArray(records, () => true, (record) => asRecord(asRecord(record).transition).domainRollbackRate)
      ),
      closureViolationRate: proportionWithCI(
        toBooleanArray(records, closureEligibility, (record) => asRecord(asRecord(record).transition).closureViolationFlag === 1)
      ),
      maxClosureSizeRatio: meanWithCI(
        toNumberArray(records, () => true, (record) => asRecord(asRecord(record).transition).maxClosureSizeRatio)
      ),
      blockedByRate: meanWithCI(
        toNumberArray(records, () => true, (record) => asRecord(asRecord(record).transition).blockedByRate)
      ),
      rejectedCount: meanWithCI(
        toNumberArray(records, () => true, (record) => asRecord(asRecord(record).transition).rejectedCount)
      ),
      riskClosureViolationRate: proportionWithCI(
        toBooleanArray(records, closureEligibility, (record) => asRecord(asRecord(record).closure).closureViolationFlag === 1)
      ),
      riskClosureRejectedCountMean: meanWithCI(
        toNumberArray(records, () => true, (record) => asRecord(asRecord(record).closure).rejectedCount)
      ),
      riskClosureBlockedByRateMean: meanWithCI(
        toNumberArray(records, () => true, (record) => asRecord(asRecord(record).closure).blockedByRate)
      ),
      riskClosureMaxClosureSizeRatioMean: meanWithCI(
        toNumberArray(records, () => true, (record) => asRecord(asRecord(record).closure).maxClosureSizeRatio)
      ),
      riskLevelL3Rate: meanWithCI(
        toNumberArray(records, () => true, (record) => asRecord(asRecord(record).closure).riskLevelL3Rate)
      ),
      suggestionsCoverageRate: meanWithCI(
        toNumberArray(records, () => true, (record) => asRecord(asRecord(record).suggestions).coverageRate)
      ),
      blockedByResolutionRate: meanWithCI(
        toNumberArray(records, () => true, (record) => asRecord(asRecord(record).suggestions).blockedByResolutionRate)
      ),
      suggestionCountMean: meanWithCI(
        toNumberArray(records, () => true, (record) => asRecord(asRecord(record).suggestions).count)
      ),
    },
  };
}

function buildComparisonMetrics(lhsRecords, rhsRecords) {
  const conflictEligibility = (record) => {
    const count = asRecord(asRecord(record).transition).conflictCount;
    return typeof count === 'number' && count > 0;
  };

  const llmEligibility = (record) => {
    const value = asRecord(asRecord(record).transition).deltaRejectedIndicator;
    return value === 0 || value === 1;
  };

  const closureEligibility = (record) => {
    const value = asRecord(asRecord(record).transition).closureViolationFlag;
    return value === 0 || value === 1;
  };

  return {
    equalsTargetRate: buildRateMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).drift).equalsTargetHash
    ),
    assertionPassRate: buildRateMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).assertions).passed
    ),
    conflictCount: buildMeanMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).transition).conflictCount
    ),
    postApplyConflictCount: buildMeanMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).transition).postApplyConflictCount
    ),
    distanceCountsSum: buildMeanMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).drift).distanceCountsSum
    ),
    rollbackRate: buildRateMetric(
      lhsRecords,
      rhsRecords,
      conflictEligibility,
      (record) => asRecord(asRecord(record).transition).rollbackIndicator === 1
    ),
    deltaRejectionRate: buildRateMetric(
      lhsRecords,
      rhsRecords,
      llmEligibility,
      (record) => asRecord(asRecord(record).transition).deltaRejectedIndicator === 1
    ),
    domainRollbackRate: buildMeanMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).transition).domainRollbackRate
    ),
    closureViolationRate: buildRateMetric(
      lhsRecords,
      rhsRecords,
      closureEligibility,
      (record) => asRecord(asRecord(record).transition).closureViolationFlag === 1
    ),
    maxClosureSizeRatio: buildMeanMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).transition).maxClosureSizeRatio
    ),
    blockedByRate: buildMeanMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).transition).blockedByRate
    ),
    rejectedCount: buildMeanMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).transition).rejectedCount
    ),
    riskClosureViolationRate: buildRateMetric(
      lhsRecords,
      rhsRecords,
      closureEligibility,
      (record) => asRecord(asRecord(record).closure).closureViolationFlag === 1
    ),
    riskClosureRejectedCountMean: buildMeanMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).closure).rejectedCount
    ),
    riskClosureBlockedByRateMean: buildMeanMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).closure).blockedByRate
    ),
    riskClosureMaxClosureSizeRatioMean: buildMeanMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).closure).maxClosureSizeRatio
    ),
    riskLevelL3Rate: buildMeanMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).closure).riskLevelL3Rate
    ),
    suggestionsCoverageRate: buildMeanMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).suggestions).coverageRate
    ),
    blockedByResolutionRate: buildMeanMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).suggestions).blockedByResolutionRate
    ),
    suggestionCountMean: buildMeanMetric(
      lhsRecords,
      rhsRecords,
      () => true,
      (record) => asRecord(asRecord(record).suggestions).count
    ),
  };
}

function buildStats(records, summaryRowsCount) {
  const tasks = buildTaskGroups(records);
  const byTask = [];
  const comparisons = [];
  const qValueTargets = [];

  const taskIds = [...tasks.keys()].sort(compareStrings);
  for (const taskId of taskIds) {
    const task = tasks.get(taskId);
    const baselineLookup = new Map();
    const baselineRows = [];

    for (const baselineName of BASELINE_ORDER) {
      const baselineGroup = task.baselines.get(baselineName);
      if (!baselineGroup) {
        const baseline = {
          name: baselineName,
          mode: null,
          baselineKey: baselineName,
          baselineModeKey: 'null',
          supported: false,
          reason: 'unsupported baseline',
        };
        baselineRows.push(aggregateBaseline([], baseline));
        baselineLookup.set(baselineName, { baseline, records: [] });
      } else {
        baselineRows.push(aggregateBaseline(baselineGroup.records, baselineGroup.baseline));
        baselineLookup.set(baselineName, baselineGroup);
      }
    }

    byTask.push({
      taskId,
      category: task.category,
      baselines: baselineRows,
    });

    for (const comparisonId of COMPARISON_ORDER) {
      const config = COMPARISON_CONFIG[comparisonId];
      const lhs = baselineLookup.get(config.lhs);
      const rhs = baselineLookup.get(config.rhs);

      let skipReason = null;
      if (config.scope === 't3' && task.category !== 'T3') {
        skipReason = 'comparison task filter';
      } else if (!lhs || !rhs || !lhs.baseline.supported || !rhs.baseline.supported) {
        skipReason = 'unsupported baseline';
      }

      if (skipReason !== null) {
        const skippedMetrics = {};
        for (const metricName of METRIC_ORDER) {
          skippedMetrics[metricName] = skippedMetric(skipReason);
        }
        comparisons.push({
          taskId,
          category: task.category,
          comparison: comparisonId,
          lhs: config.lhs,
          rhs: config.rhs,
          skipped: true,
          reason: skipReason,
          metrics: skippedMetrics,
        });
        continue;
      }

      const metrics = buildComparisonMetrics(lhs.records, rhs.records);
      const row = {
        taskId,
        category: task.category,
        comparison: comparisonId,
        lhs: config.lhs,
        rhs: config.rhs,
        skipped: false,
        reason: null,
        metrics,
      };
      comparisons.push(row);

      for (const metricName of METRIC_ORDER) {
        const metric = metrics[metricName];
        if (metric.statStatus === 'ok' && metric.pValue !== null) {
          qValueTargets.push({
            id: `${taskId}|${comparisonId}|${metricName}`,
            pValue: metric.pValue,
            setQValue(value) {
              metric.qValue = value;
            },
          });
        }
      }
    }
  }

  applyBenjaminiHochberg(qValueTargets);

  return {
    schema: 'eval2-stats-1',
    evalVersion: 'eval3',
    metricsAdded: [
      'rollbackRate',
      'deltaRejectionRate',
      'domainRollbackRate',
      'closureViolationRate',
      'maxClosureSizeRatio',
      'blockedByRate',
      'rejectedCount',
      'riskClosureViolationRate',
      'riskClosureRejectedCountMean',
      'riskClosureBlockedByRateMean',
      'riskClosureMaxClosureSizeRatioMean',
      'riskLevelL3Rate',
      'suggestionsCoverageRate',
      'blockedByResolutionRate',
      'suggestionCountMean',
    ],
    inputs: {
      experimentId: 'EVAL-1',
      alpha: ALPHA,
      files: {
        results: 'bench/out/results.jsonl',
        summary: 'bench/out/summary.json',
      },
      baselineOrder: BASELINE_ORDER,
      comparisonOrder: COMPARISON_ORDER,
      metricOrder: METRIC_ORDER,
    },
    byTask,
    comparisons,
    determinism: {
      sorted: true,
      stringComparator: 'a<b?-1:a>b?1:0',
      domainOrder: DOMAIN_ORDER,
      timestamp: null,
      summaryRowsCount,
    },
  };
}

function generateGlobalSummaryRows(stats) {
  const rows = [];

  for (const comparisonId of COMPARISON_ORDER) {
    for (const metricName of METRIC_ORDER) {
      const all = stats.comparisons.filter((entry) => entry.comparison === comparisonId);
      const ok = all.filter((entry) => entry.metrics[metricName].statStatus === 'ok');
      const skipped = all.filter((entry) => entry.metrics[metricName].statStatus === 'skipped').length;
      const insufficient = all.filter((entry) => entry.metrics[metricName].statStatus === 'insufficient_samples').length;

      let significant = 0;
      let effectTotal = 0;
      let effectCount = 0;

      for (const entry of ok) {
        const metric = entry.metrics[metricName];
        if (metric.qValue !== null && metric.qValue <= ALPHA) {
          significant += 1;
        }

        let effectValue = null;
        if (metricName === 'equalsTargetRate' || metricName === 'assertionPassRate' || metricName === 'rollbackRate' || metricName === 'deltaRejectionRate') {
          effectValue = metric.effect.riskDifference;
        } else {
          effectValue = metric.effect.cohenD;
        }

        if (typeof effectValue === 'number' && Number.isFinite(effectValue)) {
          effectTotal += effectValue;
          effectCount += 1;
        }
      }

      rows.push({
        comparison: comparisonId,
        metric: metricName,
        okTasks: ok.length,
        skippedTasks: skipped,
        insufficientTasks: insufficient,
        significantTasks: significant,
        meanEffect: effectCount === 0 ? null : round6(effectTotal / effectCount),
      });
    }
  }

  return rows;
}

function metricLine(metricName, metric) {
  if (metric.statStatus !== 'ok') {
    return `- ${metricName}: status=${metric.statStatus} reason=${metric.reason} effect=null_due_to_status p=${metric.pValue} q=${metric.qValue}`;
  }

  const effect = `riskDifference=${metric.effect.riskDifference} riskRatio=${metric.effect.riskRatio} cohenD=${metric.effect.cohenD} cliffsDelta=${metric.effect.cliffsDelta}`;
  return `- ${metricName}: status=ok reason=null estimate=${metric.estimate} ci=[${metric.ci.low},${metric.ci.high}] p=${metric.pValue} q=${metric.qValue} effect(${effect})`;
}

function buildReportMarkdown(stats) {
  const lines = [];
  lines.push('# EVAL-2 Statistical Report');
  lines.push('');
  lines.push('## Overview');
  lines.push(`- Schema: ${stats.schema}`);
  lines.push(`- EvalVersion: ${stats.evalVersion}`);
  lines.push(`- Alpha: ${stats.inputs.alpha}`);
  lines.push(`- Baselines: ${stats.inputs.baselineOrder.join(', ')}`);
  lines.push(`- Comparisons: ${stats.inputs.comparisonOrder.join(', ')}`);
  lines.push(`- MetricsAdded: ${stats.metricsAdded.join(', ')}`);
  lines.push('');

  lines.push('## Global Summary');
  lines.push('| Comparison | Metric | OkTasks | SkippedTasks | InsufficientTasks | SignificantQ<=0.05 | MeanEffect |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of generateGlobalSummaryRows(stats)) {
    lines.push(
      `| ${row.comparison} | ${row.metric} | ${row.okTasks} | ${row.skippedTasks} | ${row.insufficientTasks} | ${row.significantTasks} | ${row.meanEffect === null ? 'null' : row.meanEffect} |`
    );
  }
  lines.push('');

  lines.push('## Per-Task Detail');
  const taskIds = stats.byTask.map((item) => item.taskId).sort(compareStrings);
  for (const taskId of taskIds) {
    const task = stats.byTask.find((item) => item.taskId === taskId);
    lines.push(`### ${task.taskId} (${task.category})`);

    for (const comparisonId of COMPARISON_ORDER) {
      const comparison = stats.comparisons.find(
        (item) => item.taskId === task.taskId && item.comparison === comparisonId
      );
      lines.push(`- ${comparisonId}: ${comparison.lhs} vs ${comparison.rhs}`);
      for (const metricName of METRIC_ORDER) {
        lines.push(`  ${metricLine(metricName, comparison.metrics[metricName])}`);
      }
    }

    lines.push('');
  }

  lines.push('## Appendix: Determinism');
  lines.push(`- sorted=${stats.determinism.sorted}`);
  lines.push(`- stringComparator=${stats.determinism.stringComparator}`);
  lines.push(`- domainOrder=${stats.determinism.domainOrder.join(',')}`);
  lines.push('- timestamp=null');
  lines.push('');

  return `${lines.join('\n').trimEnd()}\n`;
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function buildDigest(resultsRows, summaryRows, statsTasks, summaryHash, statsHash) {
  const lines = [];
  lines.push('EVAL2_DIGEST');
  lines.push(`results_rows=${resultsRows}`);
  lines.push(`summary_rows=${summaryRows}`);
  lines.push(`stats_tasks=${statsTasks}`);
  lines.push(`sha256_summary=${summaryHash}`);
  lines.push(`sha256_eval2_stats=${statsHash}`);
  return `${lines.join('\n')}\n`;
}

function runStats(resultsFile, summaryFile, statsFile, reportFile, digestFile) {
  const resultsContent = fs.existsSync(resultsFile) ? fs.readFileSync(resultsFile, 'utf8') : '';
  const summaryContent = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8') : '';

  const records = parseResultsJsonl(resultsContent);
  const summary = parseSummary(summaryContent);
  const stats = buildStats(records, summary.rows.length);
  const statsJson = `${JSON.stringify(stats, null, 2)}\n`;
  const report = buildReportMarkdown(stats);

  fs.mkdirSync(path.dirname(statsFile), { recursive: true });
  fs.writeFileSync(statsFile, statsJson, 'utf8');
  fs.writeFileSync(reportFile, report, 'utf8');

  const digest = buildDigest(
    records.length,
    summary.rows.length,
    stats.byTask.length,
    sha256Text(summaryContent),
    sha256Text(statsJson)
  );
  fs.writeFileSync(digestFile, digest, 'utf8');

  return {
    rows: records.length,
    tasks: stats.byTask.length,
  };
}

function main() {
  const root = path.resolve(__dirname, '../../..');
  const outDir = path.join(root, 'bench', 'out');

  const result = runStats(
    path.join(outDir, 'results.jsonl'),
    path.join(outDir, 'summary.json'),
    path.join(outDir, 'eval2.stats.json'),
    path.join(outDir, 'eval2.report.md'),
    path.join(outDir, 'eval2.digest.txt')
  );

  process.stdout.write(`EVAL-2 stats wrote ${result.tasks} tasks from ${result.rows} rows\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  compareStrings,
  parseResultsJsonl,
  parseSummary,
  buildStats,
  buildReportMarkdown,
  runStats,
};
