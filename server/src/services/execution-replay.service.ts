import { applyDelta } from '../algebra/stateTransition/applyDelta';
import { stableHash } from '../algebra/semanticDiff/key';
import type { SemanticDelta } from '../algebra/semanticDiff/types';
import type { ExecutionRecordV1 } from './execution-record-v1';

export type SemanticState = unknown;

export function replayExecutionRecordV1(input: {
  record: ExecutionRecordV1;
  baseState: SemanticState;
  delta?: SemanticDelta | null;
}): {
  stateHashAfter: string;
  matches: boolean;
} {
  const record = input?.record;
  const expectedStateHashAfter = record?.identity?.stateHashAfter;

  if (!record || typeof record !== 'object' || typeof expectedStateHashAfter !== 'string' || expectedStateHashAfter.length === 0) {
    const error = new Error('Execution record input is invalid') as Error & { code: string };
    error.code = 'E_EXECUTION_RECORD_INVALID';
    throw error;
  }

  const delta = input.delta;
  if (!delta) {
    const error = new Error('Replay unsupported: delta is missing') as Error & { code: string };
    error.code = 'E_REPLAY_UNSUPPORTED';
    throw error;
  }

  const replayResult = applyDelta(input.baseState, delta, { mode: 'best_effort' });
  const stateHashAfter = stableHash(replayResult.nextState);

  if (stateHashAfter !== expectedStateHashAfter) {
    const error = new Error('Replay mismatch: stateHashAfter differs') as Error & { code: string };
    error.code = 'E_REPLAY_MISMATCH';
    throw error;
  }

  return {
    stateHashAfter,
    matches: true,
  };
}
