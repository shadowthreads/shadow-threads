const fs = require('fs');
const path = require('path');

const { diffState, applyDelta, detectConflicts, stableHash } = require('./algebra-bridge.cjs');
const { stripBomFromText } = require('./validate-fixtures.cjs');

function requireFromCandidates(candidates) {
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    return require(candidate);
  }
  throw new Error('unsupported baseline');
}

function loadClosureTools() {
  const root = path.resolve(__dirname, '../../..');

  try {
    const planner = requireFromCandidates([
      path.join(root, 'dist', 'services', 'delta-closure-planner.js'),
      path.join(root, 'dist', 'src', 'services', 'delta-closure-planner.js'),
    ]);
    const policyModule = requireFromCandidates([
      path.join(root, 'dist', 'services', 'delta-risk-policy.js'),
      path.join(root, 'dist', 'src', 'services', 'delta-risk-policy.js'),
    ]);
    return {
      planDeltaClosure: planner && typeof planner.planDeltaClosure === 'function' ? planner.planDeltaClosure : null,
      planDeltaClosureV1: planner && typeof planner.planDeltaClosureV1 === 'function' ? planner.planDeltaClosureV1 : null,
      defaultRiskPolicy: policyModule && policyModule.DEFAULT_RISK_POLICY_V1 ? policyModule.DEFAULT_RISK_POLICY_V1 : null,
    };
  } catch (_error) {
    return {
      planDeltaClosure: null,
      planDeltaClosureV1: null,
      defaultRiskPolicy: null,
    };
  }
}

const closureTools = loadClosureTools();

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
const MODES = {
  B1_CORE_BEST_EFFORT: 'best_effort',
  B1_CORE_STRICT: 'strict',
  B2_LLM_DELTA_BEST_EFFORT: 'best_effort',
  B2_LLM_DELTA_STRICT: 'strict',
  B3_STRICT_CLOSURE: 'strict',
  B4_STRICT_RISK_CLOSURE: 'strict',
  B5_STRICT_CLOSURE_SUGGESTIONS: 'strict',
};

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function round6(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000000) / 1000000;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toDomainState(value) {
  const record = asRecord(value);
  return {
    facts: asArray(record.facts),
    decisions: asArray(record.decisions),
    constraints: asArray(record.constraints),
    risks: asArray(record.risks),
    assumptions: asArray(record.assumptions),
  };
}

function zeroCounts() {
  return {
    facts: { added: 0, removed: 0, modified: 0 },
    decisions: { added: 0, removed: 0, modified: 0 },
    constraints: { added: 0, removed: 0, modified: 0 },
    risks: { added: 0, removed: 0, modified: 0 },
    assumptions: { added: 0, removed: 0, modified: 0 },
  };
}

function zeroRiskLevelCounts() {
  return { L0: 0, L1: 0, L2: 0, L3: 0 };
}


function rejectedTargetKey(entry) {
  const record = asRecord(entry);
  const domain = typeof record.domain === 'string' ? record.domain : 'NULL';
  const key = typeof record.key === 'string' ? record.key : 'NULL';
  const pathValue = typeof record.path === 'string' ? record.path : record.path === null ? 'NULL' : 'NULL';
  const op = typeof record.op === 'string' ? record.op : 'NULL';
  return `${domain}|${key}|${pathValue}|${op}`;
}

function suggestionTargetKey(entry) {
  const record = asRecord(entry);
  const payload = asRecord(record.payload);
  const appliesTo = asRecord(payload.appliesTo);
  const domain = typeof appliesTo.domain === 'string' ? appliesTo.domain : 'NULL';
  const key = typeof appliesTo.key === 'string' ? appliesTo.key : 'NULL';
  const pathValue = typeof appliesTo.path === 'string' ? appliesTo.path : appliesTo.path === null ? 'NULL' : 'NULL';
  const op = typeof appliesTo.op === 'string' ? appliesTo.op : 'NULL';
  return `${domain}|${key}|${pathValue}|${op}`;
}

function normalizeFieldChange(rawChange) {
  const change = asRecord(rawChange);
  const op = change.op === 'set' || change.op === 'unset' || change.op === 'append' || change.op === 'remove' ? change.op : 'set';
  return {
    path: typeof change.path === 'string' && change.path.length > 0 ? change.path : 'value',
    op,
    before: change.before,
    after: change.after,
    value: change.value,
  };
}

function normalizeDomainDelta(rawDomain) {
  const domain = asRecord(rawDomain);
  return {
    added: asArray(domain.added).map((rawItem) => {
      const item = asRecord(rawItem);
      return {
        key: typeof item.key === 'string' ? item.key : '',
        unit: Object.prototype.hasOwnProperty.call(item, 'unit') ? item.unit : {},
      };
    }),
    removed: asArray(domain.removed).map((rawItem) => {
      const item = asRecord(rawItem);
      return {
        key: typeof item.key === 'string' ? item.key : '',
        unit: Object.prototype.hasOwnProperty.call(item, 'unit') ? item.unit : {},
      };
    }),
    modified: asArray(domain.modified).map((rawItem) => {
      const item = asRecord(rawItem);
      return {
        key: typeof item.key === 'string' ? item.key : '',
        before: Object.prototype.hasOwnProperty.call(item, 'before') ? item.before : {},
        after: Object.prototype.hasOwnProperty.call(item, 'after') ? item.after : {},
        changes: asArray(item.changes).map(normalizeFieldChange),
      };
    }),
  };
}

function normalizeSemanticDelta(rawDelta) {
  const record = asRecord(rawDelta);
  const domains = {
    facts: normalizeDomainDelta(record.facts),
    decisions: normalizeDomainDelta(record.decisions),
    constraints: normalizeDomainDelta(record.constraints),
    risks: normalizeDomainDelta(record.risks),
    assumptions: normalizeDomainDelta(record.assumptions),
  };

  const counts = {};
  for (const domain of DOMAIN_ORDER) {
    const entry = domains[domain];
    counts[domain] = entry.added.length + entry.removed.length + entry.modified.length;
  }

  const normalized = {
    schemaVersion: 'sdiff-0.1',
    base: {
      revisionHash: typeof asRecord(record.base).revisionHash === 'string' ? asRecord(record.base).revisionHash : 'bench-base',
    },
    target: {
      revisionHash: typeof asRecord(record.target).revisionHash === 'string' ? asRecord(record.target).revisionHash : 'bench-target',
    },
    facts: domains.facts,
    decisions: domains.decisions,
    constraints: domains.constraints,
    risks: domains.risks,
    assumptions: domains.assumptions,
    meta: {
      determinism: {
        canonicalVersion: 'tpkg-0.2-canon-v1',
        keyStrategy: 'sig-hash-v1',
        tieBreakers: ['bench'],
      },
      collisions: {
        hard: [],
        soft: [],
      },
      assumptionsDerived: false,
      counts,
    },
  };

  stableHash(normalized);
  return normalized;
}

function parseTaskFixture(raw, fileName) {
  const record = asRecord(raw);
  const taskId = typeof record.taskId === 'string' ? record.taskId : '';
  const category = record.category === 'T1' || record.category === 'T2' || record.category === 'T3' ? record.category : null;
  const description = typeof record.description === 'string' ? record.description : '';

  if (!taskId || !category || !description) {
    throw new Error(`Invalid fixture metadata: ${fileName}`);
  }

  const runConfig = asRecord(record.runConfig);
  const repetitions = Number.isInteger(runConfig.repetitions) && runConfig.repetitions > 0 ? runConfig.repetitions : 15;

  const baseState = toDomainState(record.baseState);
  const targetState = record.targetState === undefined ? undefined : toDomainState(record.targetState);

  stableHash(baseState);
  if (targetState) stableHash(targetState);

  const coreStubDelta = record.coreStubDelta === undefined ? null : normalizeSemanticDelta(record.coreStubDelta);
  const llmStubDelta = record.llmStubDelta === undefined ? null : normalizeSemanticDelta(record.llmStubDelta);
  const proposedDelta = record.proposedDelta === undefined ? null : normalizeSemanticDelta(record.proposedDelta);

  const assertionsRecord = record.targetAssertions === undefined ? null : asRecord(record.targetAssertions);
  const normalizeDomains = (value) =>
    asArray(value)
      .filter((item) => DOMAIN_ORDER.includes(item))
      .sort((a, b) => DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b));
  const normalizeStrings = (value) => asArray(value).filter((item) => typeof item === 'string').sort(compareStrings);

  const targetAssertions = assertionsRecord
    ? {
        mustEqualTargetHash:
          typeof assertionsRecord.mustEqualTargetHash === 'boolean' ? assertionsRecord.mustEqualTargetHash : undefined,
        mustHaveNoConflicts:
          typeof assertionsRecord.mustHaveNoConflicts === 'boolean' ? assertionsRecord.mustHaveNoConflicts : undefined,
        maxDistanceCountsSum:
          typeof assertionsRecord.maxDistanceCountsSum === 'number' && Number.isFinite(assertionsRecord.maxDistanceCountsSum)
            ? assertionsRecord.maxDistanceCountsSum
            : undefined,
        domainMustNotChange: normalizeDomains(assertionsRecord.domainMustNotChange),
        requiredDomainsModified: normalizeDomains(assertionsRecord.requiredDomainsModified),
        requiredDecisionKeys: normalizeStrings(assertionsRecord.requiredDecisionKeys),
        requiredAssumptionKeys: normalizeStrings(assertionsRecord.requiredAssumptionKeys),
      }
    : undefined;

  return {
    taskId,
    category,
    description,
    baseState,
    targetState,
    coreStubDelta,
    llmStubDelta,
    proposedDelta,
    targetAssertions,
    runConfig: { repetitions },
  };
}

function summarizeDelta(delta) {
  const counts = zeroCounts();
  for (const domain of DOMAIN_ORDER) {
    const domainDelta = delta[domain] || { added: [], removed: [], modified: [] };
    counts[domain] = {
      added: asArray(domainDelta.added).length,
      removed: asArray(domainDelta.removed).length,
      modified: asArray(domainDelta.modified).length,
    };
  }

  return {
    counts,
    hasCollisions:
      asArray(asRecord(asRecord(delta.meta).collisions).soft).length > 0 ||
      asArray(asRecord(asRecord(delta.meta).collisions).hard).length > 0,
    assumptionsDerived: asRecord(delta.meta).assumptionsDerived === true,
    modifiedDomains: DOMAIN_ORDER.filter((domain) => {
      const c = counts[domain];
      return c.added + c.removed + c.modified > 0;
    }),
  };
}

function calculateDistanceCounts(delta) {
  const counts = zeroCounts();
  for (const domain of DOMAIN_ORDER) {
    const domainDelta = delta[domain] || { added: [], removed: [], modified: [] };
    counts[domain] = {
      added: asArray(domainDelta.added).length,
      removed: asArray(domainDelta.removed).length,
      modified: asArray(domainDelta.modified).length,
    };
  }
  return counts;
}

function sumDistanceCounts(counts) {
  let total = 0;
  for (const domain of DOMAIN_ORDER) {
    const c = counts[domain];
    total += c.added + c.removed + c.modified;
  }
  return total;
}

function hasMatchingKey(units, keys, expected) {
  for (const unit of units) {
    const record = asRecord(unit);
    for (const key of keys) {
      if (record[key] === expected) return true;
    }
  }
  return false;
}

function evaluateAssertions(params) {
  const {
    targetAssertions,
    equalsTargetHash,
    conflictCount,
    postApplyConflictCount,
    distanceCounts,
    distanceCountsSum,
    modifiedDomains,
    nextState,
  } = params;

  if (!targetAssertions) {
    return { passed: true, failed: [] };
  }

  const failures = [];
  const totalConflictCount = conflictCount + postApplyConflictCount;

  if (targetAssertions.mustEqualTargetHash === true && !equalsTargetHash) {
    failures.push('ASSERT_EQUALS_TARGET_HASH');
  }
  if (targetAssertions.mustEqualTargetHash === false && equalsTargetHash) {
    failures.push('ASSERT_NOT_EQUALS_TARGET_HASH');
  }

  if (typeof targetAssertions.mustHaveNoConflicts === 'boolean') {
    if (targetAssertions.mustHaveNoConflicts && totalConflictCount > 0) {
      failures.push('ASSERT_CONFLICTS_PRESENT');
    }
    if (!targetAssertions.mustHaveNoConflicts && totalConflictCount === 0) {
      failures.push('ASSERT_CONFLICTS_ABSENT');
    }
  }

  if (
    typeof targetAssertions.maxDistanceCountsSum === 'number' &&
    distanceCountsSum > targetAssertions.maxDistanceCountsSum
  ) {
    failures.push('ASSERT_DISTANCE_EXCEEDED');
  }

  for (const domain of targetAssertions.domainMustNotChange || []) {
    const c = distanceCounts[domain];
    if (c.added + c.removed + c.modified > 0) {
      failures.push('ASSERT_DOMAIN_MUST_NOT_CHANGE');
      break;
    }
  }

  for (const domain of targetAssertions.requiredDomainsModified || []) {
    if (!modifiedDomains.includes(domain)) {
      failures.push('ASSERT_REQUIRED_DOMAIN_NOT_MODIFIED');
      break;
    }
  }

  if (nextState) {
    for (const expectedKey of targetAssertions.requiredDecisionKeys || []) {
      if (!hasMatchingKey(nextState.decisions, ['id', 'key', 'decisionId', 'question', 'title'], expectedKey)) {
        failures.push('ASSERT_REQUIRED_DECISION_KEYS_MISSING');
        break;
      }
    }

    for (const expectedKey of targetAssertions.requiredAssumptionKeys || []) {
      if (!hasMatchingKey(nextState.assumptions, ['id', 'key', 'assumptionId', 'statement', 'topic'], expectedKey)) {
        failures.push('ASSERT_REQUIRED_ASSUMPTION_KEYS_MISSING');
        break;
      }
    }
  }

  const failed = [...new Set(failures)].sort(compareStrings);
  return {
    passed: failed.length === 0,
    failed,
  };
}

function normalizeSummary(summary) {
  if (!summary) return null;
  const counts = zeroCounts();
  for (const domain of DOMAIN_ORDER) {
    const c = asRecord(asRecord(summary.counts)[domain]);
    counts[domain] = {
      added: typeof c.added === 'number' ? c.added : 0,
      removed: typeof c.removed === 'number' ? c.removed : 0,
      modified: typeof c.modified === 'number' ? c.modified : 0,
    };
  }
  return {
    counts,
    hasCollisions: summary.hasCollisions === true,
    assumptionsDerived: summary.assumptionsDerived === true,
    modifiedDomains: DOMAIN_ORDER.filter((domain) => asArray(summary.modifiedDomains).includes(domain)),
  };
}

function normalizeDistanceCounts(input) {
  const counts = zeroCounts();
  for (const domain of DOMAIN_ORDER) {
    const c = asRecord(asRecord(input)[domain]);
    counts[domain] = {
      added: typeof c.added === 'number' ? c.added : 0,
      removed: typeof c.removed === 'number' ? c.removed : 0,
      modified: typeof c.modified === 'number' ? c.modified : 0,
    };
  }
  return counts;
}

function normalizeRiskCounts(input) {
  const counts = zeroRiskLevelCounts();
  const record = asRecord(input);
  counts.L0 = typeof record.L0 === 'number' ? record.L0 : 0;
  counts.L1 = typeof record.L1 === 'number' ? record.L1 : 0;
  counts.L2 = typeof record.L2 === 'number' ? record.L2 : 0;
  counts.L3 = typeof record.L3 === 'number' ? record.L3 : 0;
  return counts;
}

function stableStringifyRecord(record) {
  const normalized = {
    experiment: { id: record.experiment.id, ts: null },
    task: { taskId: record.task.taskId, category: record.task.category, rep: record.task.rep },
    baseline: {
      name: record.baseline.name,
      mode: record.baseline.mode,
      supported: record.baseline.supported,
      reason: record.baseline.reason,
    },
    identity: {
      stateHashBefore: record.identity.stateHashBefore,
      stateHashAfter: record.identity.stateHashAfter,
      targetHash: record.identity.targetHash,
    },
    delta: {
      source: record.delta.source,
      summary: normalizeSummary(record.delta.summary),
    },
    transition: {
      conflictCount: record.transition.conflictCount,
      postApplyConflictCount: record.transition.postApplyConflictCount,
      rollbackIndicator: record.transition.rollbackIndicator,
      deltaRejectedIndicator: record.transition.deltaRejectedIndicator,
      deltaDomainCount: record.transition.deltaDomainCount,
      appliedDomainCount: record.transition.appliedDomainCount,
      domainRollbackRate: record.transition.domainRollbackRate,
      closureViolationFlag: record.transition.closureViolationFlag,
      rejectedCount: record.transition.rejectedCount,
      maxClosureSizeRatio: record.transition.maxClosureSizeRatio,
      blockedByRate: record.transition.blockedByRate,
    },
    closure: {
      candidateCount: record.closure.candidateCount,
      rejectedCount: record.closure.rejectedCount,
      blockedByRate: record.closure.blockedByRate,
      maxClosureSizeRatio: record.closure.maxClosureSizeRatio,
      closureViolationFlag: record.closure.closureViolationFlag,
      riskLevelCounts: normalizeRiskCounts(record.closure.riskLevelCounts),
      riskLevelL3Rate: record.closure.riskLevelL3Rate,
    },
    suggestions: {
      count: record.suggestions.count,
      coveredRejectedCount: record.suggestions.coveredRejectedCount,
      blockedByCoveredCount: record.suggestions.blockedByCoveredCount,
      totalBlockedByEdges: record.suggestions.totalBlockedByEdges,
      coverageRate: record.suggestions.coverageRate,
      blockedByResolutionRate: record.suggestions.blockedByResolutionRate,
      actionabilityRate: record.suggestions.actionabilityRate,
      l3EscalationRate: record.suggestions.l3EscalationRate,
    },
    drift: {
      equalsTargetHash: record.drift.equalsTargetHash,
      distanceCounts: normalizeDistanceCounts(record.drift.distanceCounts),
      distanceCountsSum: record.drift.distanceCountsSum,
    },
    assertions: {
      passed: record.assertions.passed,
      failed: asArray(record.assertions.failed).sort(compareStrings),
    },
  };

  return JSON.stringify(normalized);
}

function loadFixtures(tasksDir) {
  const files = fs
    .readdirSync(tasksDir)
    .filter((file) => file.endsWith('.json'))
    .sort(compareStrings);

  return files
    .map((file) => {
      const text = stripBomFromText(fs.readFileSync(path.join(tasksDir, file), 'utf8'));
      const raw = JSON.parse(text);
      return parseTaskFixture(raw, file);
    })
    .sort((a, b) => compareStrings(a.taskId, b.taskId));
}

function baselineDefinitions() {
  return [
    { name: 'B1_CORE_BEST_EFFORT', mode: MODES.B1_CORE_BEST_EFFORT, supported: true, reason: null, family: 'core' },
    { name: 'B1_CORE_STRICT', mode: MODES.B1_CORE_STRICT, supported: true, reason: null, family: 'core' },
    { name: 'B1_PIPELINE', mode: null, supported: false, reason: 'imports services/DB', family: 'pipeline' },
    {
      name: 'B2_LLM_DELTA_BEST_EFFORT',
      mode: MODES.B2_LLM_DELTA_BEST_EFFORT,
      supported: true,
      reason: null,
      family: 'llm_stub',
    },
    {
      name: 'B2_LLM_DELTA_STRICT',
      mode: MODES.B2_LLM_DELTA_STRICT,
      supported: true,
      reason: null,
      family: 'llm_stub',
    },
    {
      name: 'B3_STRICT_CLOSURE',
      mode: MODES.B3_STRICT_CLOSURE,
      supported: true,
      reason: null,
      family: 'strict_closure',
    },
    {
      name: 'B4_STRICT_RISK_CLOSURE',
      mode: MODES.B4_STRICT_RISK_CLOSURE,
      supported: true,
      reason: null,
      family: 'risk_closure',
    },
    {
      name: 'B5_STRICT_CLOSURE_SUGGESTIONS',
      mode: MODES.B5_STRICT_CLOSURE_SUGGESTIONS,
      supported: true,
      reason: null,
      family: 'strict_closure_suggestions',
    },
  ];
}

function unsupportedRecord(task, baseline, rep, reason) {
  const stateHashBefore = stableHash(task.baseState);
  const targetHash = task.targetState ? stableHash(task.targetState) : null;
  const baselineOut = {
    name: baseline.name,
    mode: baseline.mode,
    supported: false,
    reason,
  };

  return {
    experiment: { id: 'EVAL-1', ts: null },
    task: { taskId: task.taskId, category: task.category, rep },
    baseline: baselineOut,
    identity: { stateHashBefore, stateHashAfter: null, targetHash },
    delta: { source: null, summary: null },
    transition: {
      conflictCount: 0,
      postApplyConflictCount: 0,
      rollbackIndicator: 0,
      deltaRejectedIndicator: baseline.family === 'llm_stub' ? 0 : null,
      deltaDomainCount: 0,
      appliedDomainCount: 0,
      domainRollbackRate: 0,
      closureViolationFlag: baseline.family === 'strict_closure' || baseline.family === 'risk_closure' ? 0 : null,
      rejectedCount: baseline.family === 'strict_closure' || baseline.family === 'risk_closure' ? 0 : null,
      maxClosureSizeRatio: baseline.family === 'strict_closure' || baseline.family === 'risk_closure' ? 0 : null,
      blockedByRate: baseline.family === 'strict_closure' || baseline.family === 'risk_closure' ? 0 : null,
    },
    closure: {
      candidateCount: baseline.family === 'strict_closure' || baseline.family === 'risk_closure' || baseline.family === 'strict_closure_suggestions' ? 0 : null,
      rejectedCount: baseline.family === 'strict_closure' || baseline.family === 'risk_closure' || baseline.family === 'strict_closure_suggestions' ? 0 : null,
      blockedByRate: baseline.family === 'strict_closure' || baseline.family === 'risk_closure' || baseline.family === 'strict_closure_suggestions' ? 0 : null,
      maxClosureSizeRatio: baseline.family === 'strict_closure' || baseline.family === 'risk_closure' || baseline.family === 'strict_closure_suggestions' ? 0 : null,
      closureViolationFlag: baseline.family === 'strict_closure' || baseline.family === 'risk_closure' || baseline.family === 'strict_closure_suggestions' ? 0 : null,
      riskLevelCounts: zeroRiskLevelCounts(),
      riskLevelL3Rate: baseline.family === 'strict_closure' || baseline.family === 'risk_closure' || baseline.family === 'strict_closure_suggestions' ? 0 : null,
    },
    suggestions: {
      count: baseline.family === 'strict_closure' || baseline.family === 'strict_closure_suggestions' ? 0 : null,
      coveredRejectedCount: baseline.family === 'strict_closure' || baseline.family === 'strict_closure_suggestions' ? 0 : null,
      blockedByCoveredCount: baseline.family === 'strict_closure' || baseline.family === 'strict_closure_suggestions' ? 0 : null,
      totalBlockedByEdges: baseline.family === 'strict_closure' || baseline.family === 'strict_closure_suggestions' ? 0 : null,
      coverageRate: baseline.family === 'strict_closure' || baseline.family === 'strict_closure_suggestions' ? 0 : null,
      blockedByResolutionRate: baseline.family === 'strict_closure' || baseline.family === 'strict_closure_suggestions' ? 0 : null,
      actionabilityRate: baseline.family === 'strict_closure' || baseline.family === 'strict_closure_suggestions' ? 0 : null,
      l3EscalationRate: baseline.family === 'strict_closure' || baseline.family === 'strict_closure_suggestions' ? 0 : null,
    },
    drift: {
      equalsTargetHash: false,
      distanceCounts: zeroCounts(),
      distanceCountsSum: 0,
    },
    assertions: { passed: false, failed: ['BASELINE_UNSUPPORTED'] },
  };
}

function resolveDelta(task, baseline) {
  if (baseline.family === 'pipeline') {
    return { kind: 'unsupported', reason: baseline.reason };
  }

  if (baseline.family === 'llm_stub') {
    if (task.llmStubDelta) {
      return { kind: 'ok', source: 'llm_stub', delta: task.llmStubDelta };
    }
    return { kind: 'unsupported', reason: 'unsupported baseline' };
  }

  if (baseline.family === 'strict_closure' || baseline.family === 'strict_closure_suggestions') {
    if (!closureTools.planDeltaClosure) {
      return { kind: 'unsupported', reason: 'unsupported baseline' };
    }
    if (task.llmStubDelta) {
      return { kind: 'ok', source: 'strict_closure', delta: task.llmStubDelta };
    }
    if (task.proposedDelta) {
      return { kind: 'ok', source: 'strict_closure', delta: task.proposedDelta };
    }
    if (task.coreStubDelta) {
      return { kind: 'ok', source: 'strict_closure', delta: task.coreStubDelta };
    }
    if (task.targetState) {
      return { kind: 'ok', source: 'strict_closure', delta: diffState(task.baseState, task.targetState) };
    }
    return { kind: 'unsupported', reason: 'unsupported baseline' };
  }

  if (baseline.family === 'risk_closure') {
    if (!closureTools.planDeltaClosureV1 || !closureTools.defaultRiskPolicy) {
      return { kind: 'unsupported', reason: 'unsupported baseline' };
    }
    if (task.llmStubDelta) {
      return { kind: 'ok', source: 'risk_closure', delta: task.llmStubDelta };
    }
    if (task.proposedDelta) {
      return { kind: 'ok', source: 'risk_closure', delta: task.proposedDelta };
    }
    if (task.coreStubDelta) {
      return { kind: 'ok', source: 'risk_closure', delta: task.coreStubDelta };
    }
    if (task.targetState) {
      return { kind: 'ok', source: 'risk_closure', delta: diffState(task.baseState, task.targetState) };
    }
    return { kind: 'unsupported', reason: 'unsupported baseline' };
  }

  if (task.coreStubDelta) {
    return { kind: 'ok', source: 'core_stub', delta: task.coreStubDelta };
  }

  if (task.targetState) {
    return { kind: 'ok', source: 'diff_state', delta: diffState(task.baseState, task.targetState) };
  }

  return { kind: 'unsupported', reason: 'target state required' };
}

function runSingle(task, baseline, rep) {
  const resolved = resolveDelta(task, baseline);
  if (resolved.kind === 'unsupported') {
    return unsupportedRecord(task, baseline, rep, resolved.reason);
  }

  const proposedDelta = resolved.delta;
  const mode = baseline.mode || 'best_effort';
  const stateHashBefore = stableHash(task.baseState);
  const targetHash = task.targetState ? stableHash(task.targetState) : null;

  const closurePlan =
    (baseline.family === 'strict_closure' || baseline.family === 'strict_closure_suggestions') && closureTools.planDeltaClosure
      ? closureTools.planDeltaClosure({
          baseState: task.baseState,
          proposedDelta,
          mode: 'strict',
          policy: { requirePostApplyZeroConflicts: true },
        })
      : null;

  const riskClosurePlan =
    baseline.family === 'risk_closure' && closureTools.planDeltaClosureV1 && closureTools.defaultRiskPolicy
      ? closureTools.planDeltaClosureV1({
          baseState: task.baseState,
          proposedDelta,
          mode: 'strict',
          policy: closureTools.defaultRiskPolicy,
        })
      : null;

  const plannedDelta = riskClosurePlan ? riskClosurePlan.acceptedDelta : closurePlan ? closurePlan.acceptedDelta : proposedDelta;

  const transition = applyDelta(task.baseState, plannedDelta, {
    mode:
      baseline.family === 'strict_closure' ||
      baseline.family === 'risk_closure' ||
      baseline.family === 'strict_closure_suggestions'
        ? 'best_effort'
        : mode,
  });
  const postApplyConflicts = detectConflicts(transition.nextState);
  const stateHashAfter = stableHash(transition.nextState);
  const equalsTargetHash = targetHash === null ? false : stateHashAfter === targetHash;

  const driftDelta = task.targetState ? diffState(transition.nextState, task.targetState) : null;
  const distanceCounts = driftDelta ? calculateDistanceCounts(driftDelta) : zeroCounts();
  const distanceCountsSum = driftDelta ? sumDistanceCounts(distanceCounts) : 0;

  const deltaSummary = summarizeDelta(plannedDelta);
  const appliedSummary = summarizeDelta(diffState(task.baseState, transition.nextState));
  const deltaDomainCount = deltaSummary.modifiedDomains.length;
  const appliedDomainCount = appliedSummary.modifiedDomains.length;
  const domainRollbackRate =
    deltaDomainCount === 0 ? 0 : round6(Math.max(0, Math.min(1, (deltaDomainCount - appliedDomainCount) / deltaDomainCount)));

  const conflictCount = asArray(transition.conflicts).length;
  const postApplyConflictCount = asArray(postApplyConflicts).length;
  const rollbackIndicator = conflictCount > 0 && stateHashAfter === stateHashBefore ? 1 : 0;
  const deltaRejectedIndicator =
    baseline.family === 'llm_stub' ? (mode === 'strict' && conflictCount > 0 && stateHashAfter === stateHashBefore ? 1 : 0) : null;

  const activeClosurePlan = riskClosurePlan || closurePlan;
  const riskLevelCounts = zeroRiskLevelCounts();
  if (activeClosurePlan) {
    for (const entry of asArray(activeClosurePlan.rejected)) {
      const riskLevel = asRecord(entry).riskLevel;
      if (riskLevel === 'L0' || riskLevel === 'L1' || riskLevel === 'L2' || riskLevel === 'L3') {
        riskLevelCounts[riskLevel] += 1;
      }
    }
  }

  const closureCandidateCount = activeClosurePlan ? activeClosurePlan.diagnostics.candidateCount : null;
  const closureRejectedCount = activeClosurePlan ? activeClosurePlan.rejected.length : null;
  const closureBlockedByRate = activeClosurePlan ? activeClosurePlan.diagnostics.blockedByRate : null;
  const closureMaxClosureSizeRatio = activeClosurePlan ? activeClosurePlan.diagnostics.maxClosureSizeRatio : null;
  const closureViolationFlag = activeClosurePlan ? (activeClosurePlan.diagnostics.closureViolationFlag ? 1 : 0) : null;
  const riskLevelL3Rate =
    closureCandidateCount && closureCandidateCount > 0
      ? round6(riskLevelCounts.L3 / closureCandidateCount)
      : activeClosurePlan
      ? 0
      : null;

  const suggestionRecords =
    baseline.family === 'strict_closure_suggestions' && closurePlan ? asArray(closurePlan.suggestions) : [];
  const rejectedRecords =
    (baseline.family === 'strict_closure' || baseline.family === 'strict_closure_suggestions') && closurePlan
      ? asArray(closurePlan.rejected)
      : [];
  const rejectedKeys = new Set(rejectedRecords.map((entry) => rejectedTargetKey(entry)));
  const coveredKeys = new Set();
  const actionableKeys = new Set();
  let l3EscalationCount = 0;

  for (const suggestion of suggestionRecords) {
    const key = suggestionTargetKey(suggestion);
    if (rejectedKeys.has(key)) {
      coveredKeys.add(key);
      if (asRecord(suggestion).actionType !== 'REQUEST_HUMAN_CONFIRM') {
        actionableKeys.add(key);
      }
      if (asRecord(suggestion).actionType === 'PROMOTE_TO_L3_REVIEW') {
        l3EscalationCount += 1;
      }
    }
  }

  const suggestionDiagnostics =
    baseline.family === 'strict_closure_suggestions' && closurePlan && closurePlan.suggestionDiagnostics
      ? closurePlan.suggestionDiagnostics
      : null;
  const totalBlockedByEdges =
    baseline.family === 'strict_closure_suggestions' && closurePlan
      ? rejectedRecords.reduce((total, entry) => total + asArray(asRecord(entry).blockedBy).length, 0)
      : baseline.family === 'strict_closure'
      ? 0
      : null;
  const suggestionCount =
    baseline.family === 'strict_closure_suggestions'
      ? suggestionRecords.length
      : baseline.family === 'strict_closure'
      ? 0
      : null;
  const coveredRejectedCount =
    baseline.family === 'strict_closure_suggestions'
      ? coveredKeys.size
      : baseline.family === 'strict_closure'
      ? 0
      : null;
  const blockedByCoveredCount =
    baseline.family === 'strict_closure_suggestions' && suggestionDiagnostics
      ? suggestionDiagnostics.blockedByCoveredCount
      : baseline.family === 'strict_closure'
      ? 0
      : null;
  const suggestionsCoverageRate =
    baseline.family === 'strict_closure_suggestions'
      ? round6(coveredKeys.size / Math.max(1, closureRejectedCount ?? 0))
      : baseline.family === 'strict_closure'
      ? round6(0 / Math.max(1, closureRejectedCount ?? 0))
      : null;
  const blockedByResolutionRate =
    baseline.family === 'strict_closure_suggestions'
      ? round6((blockedByCoveredCount ?? 0) / Math.max(1, totalBlockedByEdges ?? 0))
      : baseline.family === 'strict_closure'
      ? 0
      : null;
  const suggestionActionabilityRate =
    baseline.family === 'strict_closure_suggestions'
      ? round6(actionableKeys.size / Math.max(1, closureRejectedCount ?? 0))
      : baseline.family === 'strict_closure'
      ? round6(0 / Math.max(1, closureRejectedCount ?? 0))
      : null;
  const l3EscalationRate =
    baseline.family === 'strict_closure_suggestions'
      ? round6(l3EscalationCount / Math.max(1, closureRejectedCount ?? 0))
      : baseline.family === 'strict_closure'
      ? 0
      : null;

  const assertions = evaluateAssertions({
    targetAssertions: task.targetAssertions,
    equalsTargetHash,
    conflictCount,
    postApplyConflictCount,
    distanceCounts,
    distanceCountsSum,
    modifiedDomains: deltaSummary.modifiedDomains,
    nextState: toDomainState(transition.nextState),
  });

  return {
    experiment: { id: 'EVAL-1', ts: null },
    task: { taskId: task.taskId, category: task.category, rep },
    baseline: {
      name: baseline.name,
      mode: baseline.mode,
      supported: baseline.supported,
      reason: baseline.reason,
    },
    identity: { stateHashBefore, stateHashAfter, targetHash },
    delta: { source: resolved.source, summary: deltaSummary },
    transition: {
      conflictCount,
      postApplyConflictCount,
      rollbackIndicator,
      deltaRejectedIndicator,
      deltaDomainCount,
      appliedDomainCount,
      domainRollbackRate,
      closureViolationFlag,
      rejectedCount: closureRejectedCount,
      maxClosureSizeRatio: closureMaxClosureSizeRatio,
      blockedByRate: closureBlockedByRate,
    },
    closure: {
      candidateCount: closureCandidateCount,
      rejectedCount: closureRejectedCount,
      blockedByRate: closureBlockedByRate,
      maxClosureSizeRatio: closureMaxClosureSizeRatio,
      closureViolationFlag,
      riskLevelCounts,
      riskLevelL3Rate,
    },
    suggestions: {
      count: suggestionCount,
      coveredRejectedCount,
      blockedByCoveredCount,
      totalBlockedByEdges,
      coverageRate: suggestionsCoverageRate,
      blockedByResolutionRate,
      actionabilityRate: suggestionActionabilityRate,
      l3EscalationRate,
    },
    drift: {
      equalsTargetHash,
      distanceCounts,
      distanceCountsSum,
    },
    assertions,
  };
}

function runBench(tasksDir, outFile) {
  const fixtures = loadFixtures(tasksDir);
  const baselines = baselineDefinitions();
  const lines = [];

  for (const task of fixtures) {
    for (const baseline of baselines) {
      for (let rep = 1; rep <= task.runConfig.repetitions; rep += 1) {
        lines.push(stableStringifyRecord(runSingle(task, baseline, rep)));
      }
    }
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');
  return { rows: lines.length };
}

function main() {
  const root = path.resolve(__dirname, '../../..');
  const tasksDir = path.join(root, 'bench', 'tasks');
  const outFile = path.join(root, 'bench', 'out', 'results.jsonl');
  const result = runBench(tasksDir, outFile);
  process.stdout.write(`EVAL-1 runner wrote ${result.rows} rows to bench/out/results.jsonl\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  compareStrings,
  runBench,
};
