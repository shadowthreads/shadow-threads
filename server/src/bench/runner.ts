import fs from 'fs';
import path from 'path';

import { diffState } from '../algebra/semanticDiff/diffState';
import { stableHash } from '../algebra/semanticDiff/key';
import type { DomainName, SemanticDelta } from '../algebra/semanticDiff/types';
import { applyDelta } from '../algebra/stateTransition/applyDelta';
import { detectConflicts } from '../algebra/stateTransition/detectConflicts';

const DOMAIN_ORDER: DomainName[] = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];
const BASELINE_ORDER = ['B1_CORE_BEST_EFFORT', 'B1_CORE_STRICT', 'B1_PIPELINE'] as const;

const DIFF_MODES: Record<'B1_CORE_BEST_EFFORT' | 'B1_CORE_STRICT', 'best_effort' | 'strict'> = {
  B1_CORE_BEST_EFFORT: 'best_effort',
  B1_CORE_STRICT: 'strict',
};

type BaselineName = (typeof BASELINE_ORDER)[number];
type TaskCategory = 'T1' | 'T2';

type DomainCounts = {
  added: number;
  removed: number;
  modified: number;
};

type DeltaSummary = {
  counts: Record<DomainName, DomainCounts>;
  hasCollisions: boolean;
  assumptionsDerived: boolean;
  modifiedDomains: DomainName[];
};

type TargetAssertions = {
  mustEqualTargetHash?: boolean;
  mustHaveNoConflicts?: boolean;
  maxDistanceCountsSum?: number;
  domainMustNotChange?: DomainName[];
  requiredDomainsModified?: DomainName[];
  requiredDecisionKeys?: string[];
  requiredAssumptionKeys?: string[];
};

type TaskFixture = {
  taskId: string;
  category: TaskCategory;
  description: string;
  baseState: Record<DomainName, unknown[]>;
  targetState?: Record<DomainName, unknown[]>;
  targetAssertions?: TargetAssertions;
  runConfig: { repetitions: number };
};

type BaselineRecord = {
  name: BaselineName;
  mode: 'best_effort' | 'strict' | null;
  supported: boolean;
  reason: string | null;
};

type BenchResultRecord = {
  experiment: { id: string; ts: null };
  task: { taskId: string; category: TaskCategory; rep: number };
  baseline: BaselineRecord;
  identity: {
    stateHashBefore: string | null;
    stateHashAfter: string | null;
    targetHash: string | null;
  };
  delta: {
    summary: DeltaSummary | null;
  };
  transition: {
    conflictCount: number;
    postApplyConflictCount: number;
  };
  drift: {
    equalsTargetHash: boolean;
    distanceCounts: Record<DomainName, DomainCounts>;
    distanceCountsSum: number;
  };
  assertions: {
    passed: boolean;
    failed: string[];
  };
};

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toDomainState(value: unknown): Record<DomainName, unknown[]> {
  const record = isRecord(value) ? value : {};
  return {
    facts: asArray(record.facts),
    decisions: asArray(record.decisions),
    constraints: asArray(record.constraints),
    risks: asArray(record.risks),
    assumptions: asArray(record.assumptions),
  };
}

function parseTaskFixture(raw: unknown, fixtureFile: string): TaskFixture {
  if (!isRecord(raw)) {
    throw new Error(`Invalid fixture shape: ${fixtureFile}`);
  }

  const taskId = typeof raw.taskId === 'string' ? raw.taskId : '';
  const category = raw.category === 'T1' || raw.category === 'T2' ? raw.category : null;
  const description = typeof raw.description === 'string' ? raw.description : '';

  if (!taskId || !category || !description) {
    throw new Error(`Invalid fixture metadata: ${fixtureFile}`);
  }

  const runConfigRaw = isRecord(raw.runConfig) ? raw.runConfig : {};
  const repetitionsRaw = runConfigRaw.repetitions;
  const repetitions = typeof repetitionsRaw === 'number' && Number.isInteger(repetitionsRaw) && repetitionsRaw > 0 ? repetitionsRaw : 15;

  const baseState = toDomainState(raw.baseState);
  const targetState = raw.targetState === undefined ? undefined : toDomainState(raw.targetState);

  stableHash(baseState);
  if (targetState) stableHash(targetState);

  const assertionsRaw = isRecord(raw.targetAssertions) ? raw.targetAssertions : undefined;
  const normalizeDomainArray = (value: unknown): DomainName[] =>
    asArray(value)
      .filter((item): item is DomainName =>
        item === 'facts' ||
        item === 'decisions' ||
        item === 'constraints' ||
        item === 'risks' ||
        item === 'assumptions'
      )
      .sort((a, b) => DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b));

  const normalizeStringArray = (value: unknown): string[] =>
    asArray(value)
      .filter((item): item is string => typeof item === 'string' && item.length > 0)
      .sort(compareString);

  const targetAssertions: TargetAssertions | undefined = assertionsRaw
    ? {
        mustEqualTargetHash:
          typeof assertionsRaw.mustEqualTargetHash === 'boolean' ? assertionsRaw.mustEqualTargetHash : undefined,
        mustHaveNoConflicts:
          typeof assertionsRaw.mustHaveNoConflicts === 'boolean' ? assertionsRaw.mustHaveNoConflicts : undefined,
        maxDistanceCountsSum:
          typeof assertionsRaw.maxDistanceCountsSum === 'number' && Number.isFinite(assertionsRaw.maxDistanceCountsSum)
            ? assertionsRaw.maxDistanceCountsSum
            : undefined,
        domainMustNotChange: normalizeDomainArray(assertionsRaw.domainMustNotChange),
        requiredDomainsModified: normalizeDomainArray(assertionsRaw.requiredDomainsModified),
        requiredDecisionKeys: normalizeStringArray(assertionsRaw.requiredDecisionKeys),
        requiredAssumptionKeys: normalizeStringArray(assertionsRaw.requiredAssumptionKeys),
      }
    : undefined;

  return {
    taskId,
    category,
    description,
    baseState,
    targetState,
    targetAssertions,
    runConfig: { repetitions },
  };
}

function zeroCounts(): Record<DomainName, DomainCounts> {
  return {
    facts: { added: 0, removed: 0, modified: 0 },
    decisions: { added: 0, removed: 0, modified: 0 },
    constraints: { added: 0, removed: 0, modified: 0 },
    risks: { added: 0, removed: 0, modified: 0 },
    assumptions: { added: 0, removed: 0, modified: 0 },
  };
}

function summarizeDelta(delta: SemanticDelta): DeltaSummary {
  const counts = zeroCounts();

  for (const domain of DOMAIN_ORDER) {
    counts[domain] = {
      added: delta[domain].added.length,
      removed: delta[domain].removed.length,
      modified: delta[domain].modified.length,
    };
  }

  return {
    counts,
    hasCollisions: delta.meta.collisions.hard.length > 0 || delta.meta.collisions.soft.length > 0,
    assumptionsDerived: delta.meta.assumptionsDerived === true,
    modifiedDomains: DOMAIN_ORDER.filter((domain) => {
      const domainCounts = counts[domain];
      return domainCounts.added + domainCounts.removed + domainCounts.modified > 0;
    }),
  };
}

function calculateDistanceCounts(delta: SemanticDelta): Record<DomainName, DomainCounts> {
  const counts = zeroCounts();
  for (const domain of DOMAIN_ORDER) {
    counts[domain] = {
      added: delta[domain].added.length,
      removed: delta[domain].removed.length,
      modified: delta[domain].modified.length,
    };
  }
  return counts;
}

function sumDistanceCounts(counts: Record<DomainName, DomainCounts>): number {
  let total = 0;
  for (const domain of DOMAIN_ORDER) {
    total += counts[domain].added + counts[domain].removed + counts[domain].modified;
  }
  return total;
}

function hasMatchingKey(units: unknown[], candidates: string[], expected: string): boolean {
  for (const unit of units) {
    if (!isRecord(unit)) continue;
    for (const field of candidates) {
      const value = unit[field];
      if (typeof value === 'string' && value === expected) return true;
    }
  }
  return false;
}

function evaluateAssertions(params: {
  targetAssertions: TargetAssertions | undefined;
  equalsTargetHash: boolean;
  conflictCount: number;
  postApplyConflictCount: number;
  distanceCounts: Record<DomainName, DomainCounts>;
  distanceCountsSum: number;
  modifiedDomains: DomainName[];
  nextState: Record<DomainName, unknown[]> | null;
}): { passed: boolean; failed: string[] } {
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

  if (!targetAssertions) return { passed: true, failed: [] };

  const failures: string[] = [];
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
    Number.isFinite(targetAssertions.maxDistanceCountsSum) &&
    distanceCountsSum > targetAssertions.maxDistanceCountsSum
  ) {
    failures.push('ASSERT_DISTANCE_EXCEEDED');
  }

  for (const domain of targetAssertions.domainMustNotChange ?? []) {
    const count = distanceCounts[domain];
    if (count.added + count.removed + count.modified > 0) {
      failures.push('ASSERT_DOMAIN_MUST_NOT_CHANGE');
      break;
    }
  }

  for (const domain of targetAssertions.requiredDomainsModified ?? []) {
    if (!modifiedDomains.includes(domain)) {
      failures.push('ASSERT_REQUIRED_DOMAIN_NOT_MODIFIED');
      break;
    }
  }

  if (nextState) {
    for (const expectedDecisionKey of targetAssertions.requiredDecisionKeys ?? []) {
      if (
        !hasMatchingKey(
          nextState.decisions,
          ['id', 'key', 'decisionId', 'question', 'title'],
          expectedDecisionKey
        )
      ) {
        failures.push('ASSERT_REQUIRED_DECISION_KEYS_MISSING');
        break;
      }
    }

    for (const expectedAssumptionKey of targetAssertions.requiredAssumptionKeys ?? []) {
      if (
        !hasMatchingKey(
          nextState.assumptions,
          ['id', 'key', 'assumptionId', 'statement', 'topic'],
          expectedAssumptionKey
        )
      ) {
        failures.push('ASSERT_REQUIRED_ASSUMPTION_KEYS_MISSING');
        break;
      }
    }
  }

  const failed = [...new Set(failures)].sort(compareString);
  return {
    passed: failed.length === 0,
    failed,
  };
}

function normalizeDeltaSummary(summary: DeltaSummary | null): DeltaSummary | null {
  if (!summary) return null;

  const counts = zeroCounts();
  for (const domain of DOMAIN_ORDER) {
    const domainCounts = summary.counts[domain] ?? { added: 0, removed: 0, modified: 0 };
    counts[domain] = {
      added: domainCounts.added,
      removed: domainCounts.removed,
      modified: domainCounts.modified,
    };
  }

  return {
    counts,
    hasCollisions: summary.hasCollisions,
    assumptionsDerived: summary.assumptionsDerived,
    modifiedDomains: DOMAIN_ORDER.filter((domain) => summary.modifiedDomains.includes(domain)),
  };
}

function normalizeDistanceCounts(counts: Record<DomainName, DomainCounts>): Record<DomainName, DomainCounts> {
  const out = zeroCounts();
  for (const domain of DOMAIN_ORDER) {
    const domainCounts = counts[domain] ?? { added: 0, removed: 0, modified: 0 };
    out[domain] = {
      added: domainCounts.added,
      removed: domainCounts.removed,
      modified: domainCounts.modified,
    };
  }
  return out;
}

function stableStringifyRecord(record: BenchResultRecord): string {
  const normalized: BenchResultRecord = {
    experiment: {
      id: record.experiment.id,
      ts: null,
    },
    task: {
      taskId: record.task.taskId,
      category: record.task.category,
      rep: record.task.rep,
    },
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
      summary: normalizeDeltaSummary(record.delta.summary),
    },
    transition: {
      conflictCount: record.transition.conflictCount,
      postApplyConflictCount: record.transition.postApplyConflictCount,
    },
    drift: {
      equalsTargetHash: record.drift.equalsTargetHash,
      distanceCounts: normalizeDistanceCounts(record.drift.distanceCounts),
      distanceCountsSum: record.drift.distanceCountsSum,
    },
    assertions: {
      passed: record.assertions.passed,
      failed: [...record.assertions.failed].sort(compareString),
    },
  };

  return JSON.stringify(normalized);
}

function baselineDefinitions(): BaselineRecord[] {
  return [
    { name: 'B1_CORE_BEST_EFFORT', mode: DIFF_MODES.B1_CORE_BEST_EFFORT, supported: true, reason: null },
    { name: 'B1_CORE_STRICT', mode: DIFF_MODES.B1_CORE_STRICT, supported: true, reason: null },
    {
      name: 'B1_PIPELINE',
      mode: null,
      supported: false,
      reason: 'imports services/DB',
    },
  ];
}

function runSingle(
  task: TaskFixture,
  baseline: BaselineRecord,
  rep: number
): BenchResultRecord {
  const stateHashBefore = stableHash(task.baseState);
  const targetHash = task.targetState ? stableHash(task.targetState) : null;

  if (!baseline.supported) {
    const assertions = {
      passed: false,
      failed: ['BASELINE_UNSUPPORTED'],
    };

    return {
      experiment: { id: 'EVAL-1', ts: null },
      task: { taskId: task.taskId, category: task.category, rep },
      baseline,
      identity: {
        stateHashBefore,
        stateHashAfter: null,
        targetHash,
      },
      delta: {
        summary: null,
      },
      transition: {
        conflictCount: 0,
        postApplyConflictCount: 0,
      },
      drift: {
        equalsTargetHash: false,
        distanceCounts: zeroCounts(),
        distanceCountsSum: 0,
      },
      assertions,
    };
  }

  if (!task.targetState) {
    const assertions = {
      passed: false,
      failed: ['TARGET_STATE_REQUIRED'],
    };

    return {
      experiment: { id: 'EVAL-1', ts: null },
      task: { taskId: task.taskId, category: task.category, rep },
      baseline,
      identity: {
        stateHashBefore,
        stateHashAfter: null,
        targetHash,
      },
      delta: {
        summary: null,
      },
      transition: {
        conflictCount: 0,
        postApplyConflictCount: 0,
      },
      drift: {
        equalsTargetHash: false,
        distanceCounts: zeroCounts(),
        distanceCountsSum: 0,
      },
      assertions,
    };
  }

  const delta = diffState(task.baseState, task.targetState);
  const transition = applyDelta(task.baseState, delta, { mode: baseline.mode ?? 'best_effort' });
  const postApplyConflicts = detectConflicts(transition.nextState);
  const driftDelta = diffState(transition.nextState, task.targetState);

  const stateHashAfter = stableHash(transition.nextState);
  const equalsTargetHash = stateHashAfter === targetHash;
  const distanceCounts = calculateDistanceCounts(driftDelta);
  const distanceCountsSum = sumDistanceCounts(distanceCounts);

  const assertions = evaluateAssertions({
    targetAssertions: task.targetAssertions,
    equalsTargetHash,
    conflictCount: transition.conflicts.length,
    postApplyConflictCount: postApplyConflicts.length,
    distanceCounts,
    distanceCountsSum,
    modifiedDomains: summarizeDelta(delta).modifiedDomains,
    nextState: toDomainState(transition.nextState),
  });

  return {
    experiment: { id: 'EVAL-1', ts: null },
    task: { taskId: task.taskId, category: task.category, rep },
    baseline,
    identity: {
      stateHashBefore,
      stateHashAfter,
      targetHash,
    },
    delta: {
      summary: summarizeDelta(delta),
    },
    transition: {
      conflictCount: transition.conflicts.length,
      postApplyConflictCount: postApplyConflicts.length,
    },
    drift: {
      equalsTargetHash,
      distanceCounts,
      distanceCountsSum,
    },
    assertions,
  };
}

function loadFixtures(tasksDir: string): TaskFixture[] {
  const files = fs
    .readdirSync(tasksDir)
    .filter((file) => file.endsWith('.json'))
    .sort(compareString);

  const fixtures = files.map((file) => {
    const fullPath = path.join(tasksDir, file);
    const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as unknown;
    return parseTaskFixture(raw, file);
  });

  return fixtures.sort((a, b) => compareString(a.taskId, b.taskId));
}

export function runBench(tasksDir: string, outFile: string): { rows: number } {
  const fixtures = loadFixtures(tasksDir);
  const baselines = baselineDefinitions();
  const lines: string[] = [];

  for (const task of fixtures) {
    for (const baseline of baselines) {
      for (let rep = 1; rep <= task.runConfig.repetitions; rep += 1) {
        const row = runSingle(task, baseline, rep);
        lines.push(stableStringifyRecord(row));
      }
    }
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const payload = lines.length > 0 ? `${lines.join('\n')}\n` : '';
  fs.writeFileSync(outFile, payload, 'utf8');

  return { rows: lines.length };
}

function main(): void {
  const root = process.cwd();
  const tasksDir = path.resolve(root, 'bench', 'tasks');
  const outFile = path.resolve(root, 'bench', 'out', 'results.jsonl');
  const result = runBench(tasksDir, outFile);
  process.stdout.write(`EVAL-1 runner wrote ${result.rows} rows to ${outFile}\n`);
}

if (require.main === module) {
  main();
}
