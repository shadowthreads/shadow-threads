import { describe, expect, it } from 'vitest';

import { applyDelta } from '../../algebra/stateTransition/applyDelta';
import { stableHash } from '../../algebra/semanticDiff/key';
import { replayExecutionRecordV1, type SemanticState } from '../execution-replay.service';
import type { ExecutionRecordV1 } from '../execution-record-v1';

function createBaseState(): SemanticState {
  return {
    facts: [],
    decisions: [],
    constraints: [],
    risks: [],
    assumptions: [],
  };
}

function createDelta() {
  return {
    schemaVersion: 'sdiff-0.1' as const,
    base: { revisionHash: 'base-hash' },
    target: { revisionHash: 'target-hash' },
    facts: { added: [], removed: [], modified: [] },
    decisions: {
      added: [
        {
          key: 'decisions-key-1',
          unit: { question: 'Ship now?', answer: 'yes' },
        },
      ],
      removed: [],
      modified: [],
    },
    constraints: { added: [], removed: [], modified: [] },
    risks: { added: [], removed: [], modified: [] },
    assumptions: { added: [], removed: [], modified: [] },
    meta: {
      determinism: {
        canonicalVersion: 'tpkg-0.2-canon-v1' as const,
        keyStrategy: 'sig-hash-v1' as const,
        tieBreakers: ['test'],
      },
      collisions: { soft: [], hard: [] },
      counts: {},
      assumptionsDerived: false,
    },
  };
}

function createRecord(stateHashAfter: string): ExecutionRecordV1 {
  return {
    schema: 'execution-record-1',
    ids: {
      taskPackageId: 'pkg-1',
      packageRevisionId: 'rev-1',
      baseRevisionId: 'rev-1',
      targetRevisionId: 'rev-2',
    },
    mode: 'llm_delta',
    inputs: {
      execution: {
        llmMode: 'delta',
        transitionMode: 'best_effort',
        llmDeltaMode: 'best_effort',
        revisionNetDelta: null,
        usedInjectedDelta: true,
      },
      delta: null,
      deltaSummary: null,
    },
    outputs: {
      applyReportV1: {
        schema: 'apply-report-1',
        mode: 'llm_delta',
        execution: {
          llmMode: 'delta',
          transitionMode: 'best_effort',
          revisionNetDelta: null,
          usedInjectedDelta: true,
        },
        identity: {
          stateHashBefore: null,
          stateHashAfter,
          baseRevisionId: 'rev-1',
          targetRevisionId: 'rev-2',
        },
        delta: { summary: null },
        transition: { appliedCounts: null, rejectedCounts: null },
        conflictSurface: { conflicts: [], postApplyConflicts: [] },
        findings: [],
        determinism: {
          sorted: true,
          domainOrder: ['facts', 'decisions', 'constraints', 'risks', 'assumptions'],
        },
      },
    },
    identity: {
      stateHashBefore: null,
      stateHashAfter,
      deltaHash: null,
      reportHash: 'report-hash',
    },
    determinism: {
      sorted: true,
      domainOrder: ['facts', 'decisions', 'constraints', 'risks', 'assumptions'],
    },
  };
}

describe('replayExecutionRecordV1', () => {
  it('returns matches=true for successful replay', () => {
    const baseState = createBaseState();
    const delta = createDelta();
    const expectedAfter = stableHash(applyDelta(baseState, delta, { mode: 'best_effort' }).nextState);
    const record = createRecord(expectedAfter);

    const replay = replayExecutionRecordV1({ record, baseState, delta });

    expect(replay).toEqual({
      stateHashAfter: expectedAfter,
      matches: true,
    });
  });

  it('throws E_REPLAY_UNSUPPORTED when delta is missing', () => {
    const baseState = createBaseState();
    const record = createRecord('hash-after');

    try {
      replayExecutionRecordV1({ record, baseState, delta: null });
      throw new Error('expected replayExecutionRecordV1 to throw');
    } catch (error) {
      expect((error as any).code).toBe('E_REPLAY_UNSUPPORTED');
      expect((error as Error).message).toBe('Replay unsupported: delta is missing');
    }
  });

  it('throws E_REPLAY_MISMATCH when stateHashAfter differs', () => {
    const baseState = createBaseState();
    const delta = createDelta();
    const record = createRecord('wrong-hash');

    try {
      replayExecutionRecordV1({ record, baseState, delta });
      throw new Error('expected replayExecutionRecordV1 to throw');
    } catch (error) {
      expect((error as any).code).toBe('E_REPLAY_MISMATCH');
      expect((error as Error).message).toBe('Replay mismatch: stateHashAfter differs');
    }
  });

  it('throws E_EXECUTION_RECORD_INVALID for invalid record', () => {
    const baseState = createBaseState();
    const delta = createDelta();

    try {
      replayExecutionRecordV1({ record: {} as any, baseState, delta });
      throw new Error('expected replayExecutionRecordV1 to throw');
    } catch (error) {
      expect((error as any).code).toBe('E_EXECUTION_RECORD_INVALID');
      expect((error as Error).message).toBe('Execution record input is invalid');
    }
  });

  it('is deterministic for identical input', () => {
    const baseState = createBaseState();
    const delta = createDelta();
    const expectedAfter = stableHash(applyDelta(baseState, delta, { mode: 'best_effort' }).nextState);
    const record = createRecord(expectedAfter);

    const first = replayExecutionRecordV1({ record, baseState, delta });
    const second = replayExecutionRecordV1({ record, baseState, delta });

    expect(first.stateHashAfter).toBe(second.stateHashAfter);
    expect(first.matches).toBe(true);
    expect(second.matches).toBe(true);
  });
});
