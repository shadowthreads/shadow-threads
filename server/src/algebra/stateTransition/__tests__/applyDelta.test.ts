import { describe, expect, it } from 'vitest';

import { computeUnitKey } from '../../semanticDiff/key';
import type { SemanticDelta } from '../../semanticDiff/types';
import { applyDelta } from '../applyDelta';

function createBaseState(overrides: Record<string, unknown> = {}) {
  return {
    manifest: {
      schemaVersion: 'tpkg-0.2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'Transition State',
      capabilities: {
        applyModes: ['bootstrap', 'constrain', 'review'],
        conflictHandling: 'report_only',
      },
    },
    intent: {
      primary: 'advance task',
      successCriteria: [],
      nonGoals: [],
    },
    state: {
      facts: [],
      decisions: [],
      assumptions: [],
      openLoops: [],
    },
    constraints: [],
    interfaces: {
      apis: [],
      modules: [],
    },
    risks: [],
    evidence: [],
    history: {
      origin: 'manual',
      revision: 0,
    },
    compat: {
      accepts: ['tpkg-0.1'],
      downgradeStrategy: 'lossy-allowed',
    },
    facts: [],
    decisions: [],
    assumptions: [],
    ...overrides,
  };
}

function emptyDelta(): SemanticDelta {
  return {
    schemaVersion: 'sdiff-0.1',
    base: { revisionHash: 'rev-a' },
    target: { revisionHash: 'rev-b' },
    facts: { added: [], removed: [], modified: [] },
    decisions: { added: [], removed: [], modified: [] },
    constraints: { added: [], removed: [], modified: [] },
    risks: { added: [], removed: [], modified: [] },
    assumptions: { added: [], removed: [], modified: [] },
    meta: {
      determinism: {
        canonicalVersion: 'tpkg-0.2-canon-v1',
        keyStrategy: 'sig-hash-v1',
        tieBreakers: [],
      },
      collisions: { soft: [], hard: [] },
      counts: {},
    },
  };
}

describe('applyDelta', () => {
  it('is idempotent when applying the same delta twice', () => {
    const fact = { id: 'f-1', value: 'deterministic-fact' };
    const key = computeUnitKey('facts', fact);
    const delta = emptyDelta();
    delta.facts.added = [{ key, unit: fact }];

    const first = applyDelta(createBaseState(), delta);
    const second = applyDelta(first.nextState, delta);

    expect((first.nextState as any).facts).toHaveLength(1);
    expect(second.nextState).toEqual(first.nextState);
    expect(second.conflicts.some((item) => item.code === 'E_ADD_EXISTS' && item.domain === 'facts')).toBe(true);
  });

  it('returns deterministic existence conflict codes', () => {
    const existingDecision = { question: 'Ship?', answer: 'no' };
    const existingDecisionKey = computeUnitKey('decisions', existingDecision);
    const missingFact = { id: 'f-missing', value: 'x' };
    const missingRiskBefore = { id: 'r-1', title: 'risk', impact: 'low' };

    const delta = emptyDelta();
    delta.decisions.added = [{ key: existingDecisionKey, unit: existingDecision }];
    delta.facts.removed = [{ key: computeUnitKey('facts', missingFact), unit: missingFact }];
    delta.risks.modified = [
      {
        key: computeUnitKey('risks', missingRiskBefore),
        before: missingRiskBefore,
        after: { ...missingRiskBefore, impact: 'high' },
        changes: [{ path: 'impact', op: 'set', before: 'low', after: 'high' }],
      },
    ];

    const result = applyDelta(
      createBaseState({
        decisions: [existingDecision],
      }),
      delta
    );

    const codes = result.conflicts.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(['E_ADD_EXISTS', 'E_REMOVE_MISSING', 'E_MODIFY_MISSING']));
  });

  it('shows strict vs best_effort difference per domain', () => {
    const existing = { question: 'Policy?', answer: 'A' };
    const existingKey = computeUnitKey('decisions', existing);
    const newDecision = { question: 'Timeline?', answer: 'B' };
    const newKey = computeUnitKey('decisions', newDecision);

    const delta = emptyDelta();
    delta.decisions.added = [
      { key: existingKey, unit: existing },
      { key: newKey, unit: newDecision },
    ];

    const current = createBaseState({ decisions: [existing] });

    const bestEffort = applyDelta(current, delta, { mode: 'best_effort' });
    expect((bestEffort.nextState as any).decisions).toHaveLength(2);
    expect(bestEffort.applied.perDomain.decisions.added).toBe(1);
    expect(bestEffort.rejected.perDomain.decisions.added).toBe(1);

    const strict = applyDelta(current, delta, { mode: 'strict' });
    expect((strict.nextState as any).decisions).toHaveLength(1);
    expect(strict.applied.perDomain.decisions.added).toBe(0);
    expect(strict.rejected.perDomain.decisions.added).toBe(2);
    expect(strict.conflicts.some((item) => item.code === 'E_ADD_EXISTS' && item.domain === 'decisions')).toBe(true);
  });

  it('matches modified target by delta key using sig-hash identity', () => {
    const decision = { question: 'Release now?', answer: 'no', rationale: 'pending checks' };
    const key = computeUnitKey('decisions', decision);
    const delta = emptyDelta();
    delta.decisions.modified = [
      {
        key,
        before: decision,
        after: { ...decision, answer: 'yes' },
        changes: [{ path: 'answer', op: 'set', before: 'no', after: 'yes' }],
      },
    ];

    const result = applyDelta(createBaseState({ decisions: [decision] }), delta);
    const updated = (result.nextState as any).decisions[0];
    expect(updated.answer).toBe('yes');
    expect(result.applied.perDomain.decisions.modified).toBe(1);
    expect(result.rejected.perDomain.decisions.modified).toBe(0);
  });
});
