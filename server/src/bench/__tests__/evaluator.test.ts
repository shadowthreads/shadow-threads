import { describe, expect, it } from 'vitest';

import { stableHash } from '../../algebra/semanticDiff/key';
import {
  evaluateResults,
  renderSummaryMarkdown,
  type BenchResultRecord,
} from '../evaluator';

const ZERO_COUNTS = {
  facts: { added: 0, removed: 0, modified: 0 },
  decisions: { added: 0, removed: 0, modified: 0 },
  constraints: { added: 0, removed: 0, modified: 0 },
  risks: { added: 0, removed: 0, modified: 0 },
  assumptions: { added: 0, removed: 0, modified: 0 },
};

type RecordInput = {
  taskId: string;
  category: 'T1' | 'T2';
  rep: number;
  baselineName: 'B1_CORE_BEST_EFFORT' | 'B1_CORE_STRICT' | 'B1_PIPELINE';
  mode: 'best_effort' | 'strict' | null;
  supported: boolean;
  reason?: string | null;
  stateHashAfter: string | null;
  equalsTargetHash: boolean;
  conflictCount: number;
  postApplyConflictCount: number;
  distanceCountsSum: number;
  passed: boolean;
};

function makeRecord(input: RecordInput): BenchResultRecord {
  return {
    experiment: { id: 'EVAL-1', ts: null },
    task: {
      taskId: input.taskId,
      category: input.category,
      rep: input.rep,
    },
    baseline: {
      name: input.baselineName,
      mode: input.mode,
      supported: input.supported,
      reason: input.reason ?? null,
    },
    identity: {
      stateHashBefore: 'before',
      stateHashAfter: input.stateHashAfter,
      targetHash: 'target',
    },
    delta: { summary: null },
    transition: {
      conflictCount: input.conflictCount,
      postApplyConflictCount: input.postApplyConflictCount,
    },
    drift: {
      equalsTargetHash: input.equalsTargetHash,
      distanceCounts: ZERO_COUNTS,
      distanceCountsSum: input.distanceCountsSum,
    },
    assertions: {
      passed: input.passed,
      failed: input.passed ? [] : ['ASSERT_FAILED'],
    },
  };
}

describe('bench evaluator determinism', () => {
  it('is permutation-stable for summary json and markdown', () => {
    const recordsA: BenchResultRecord[] = [
      makeRecord({
        taskId: 't1_alpha',
        category: 'T1',
        rep: 1,
        baselineName: 'B1_CORE_BEST_EFFORT',
        mode: 'best_effort',
        supported: true,
        stateHashAfter: 'hash-a',
        equalsTargetHash: true,
        conflictCount: 0,
        postApplyConflictCount: 0,
        distanceCountsSum: 0,
        passed: true,
      }),
      makeRecord({
        taskId: 't1_alpha',
        category: 'T1',
        rep: 2,
        baselineName: 'B1_CORE_BEST_EFFORT',
        mode: 'best_effort',
        supported: true,
        stateHashAfter: 'hash-a',
        equalsTargetHash: true,
        conflictCount: 0,
        postApplyConflictCount: 0,
        distanceCountsSum: 0,
        passed: true,
      }),
      makeRecord({
        taskId: 't1_alpha',
        category: 'T1',
        rep: 1,
        baselineName: 'B1_CORE_STRICT',
        mode: 'strict',
        supported: true,
        stateHashAfter: 'hash-b',
        equalsTargetHash: false,
        conflictCount: 1,
        postApplyConflictCount: 0,
        distanceCountsSum: 1,
        passed: false,
      }),
      makeRecord({
        taskId: 't1_alpha',
        category: 'T1',
        rep: 1,
        baselineName: 'B1_PIPELINE',
        mode: null,
        supported: false,
        reason: 'imports services/DB',
        stateHashAfter: null,
        equalsTargetHash: false,
        conflictCount: 0,
        postApplyConflictCount: 0,
        distanceCountsSum: 0,
        passed: false,
      }),
    ];

    const recordsB = [recordsA[3], recordsA[1], recordsA[0], recordsA[2]];

    const summaryA = evaluateResults(recordsA);
    const summaryB = evaluateResults(recordsB);

    expect(stableHash(summaryA)).toBe(stableHash(summaryB));
    expect(renderSummaryMarkdown(summaryA)).toBe(renderSummaryMarkdown(summaryB));
  });

  it('renders task headings in fixed string-order', () => {
    const records: BenchResultRecord[] = [
      makeRecord({
        taskId: 't2_beta',
        category: 'T2',
        rep: 1,
        baselineName: 'B1_CORE_BEST_EFFORT',
        mode: 'best_effort',
        supported: true,
        stateHashAfter: 'hash-z',
        equalsTargetHash: true,
        conflictCount: 0,
        postApplyConflictCount: 0,
        distanceCountsSum: 0,
        passed: true,
      }),
      makeRecord({
        taskId: 't1_alpha',
        category: 'T1',
        rep: 1,
        baselineName: 'B1_CORE_BEST_EFFORT',
        mode: 'best_effort',
        supported: true,
        stateHashAfter: 'hash-y',
        equalsTargetHash: true,
        conflictCount: 0,
        postApplyConflictCount: 0,
        distanceCountsSum: 0,
        passed: true,
      }),
    ];

    const markdown = renderSummaryMarkdown(evaluateResults(records));
    const t1Heading = markdown.indexOf('## t1_alpha (T1)');
    const t2Heading = markdown.indexOf('## t2_beta (T2)');

    expect(t1Heading).toBeGreaterThanOrEqual(0);
    expect(t2Heading).toBeGreaterThanOrEqual(0);
    expect(t1Heading).toBeLessThan(t2Heading);
  });
});
