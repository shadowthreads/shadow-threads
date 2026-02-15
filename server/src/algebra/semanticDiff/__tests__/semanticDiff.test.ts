import { describe, expect, it } from 'vitest';

import { diffState } from '../diffState';

function createState(overrides: Record<string, unknown> = {}) {
  return {
    revisionHash: 'rev-base',
    facts: [],
    decisions: [],
    constraints: [],
    risks: [],
    assumptions: [],
    ...overrides,
  };
}

describe('semantic diff (sdiff-0.1)', () => {
  it('returns empty delta for identical state', () => {
    const state = createState({
      revisionHash: 'hash-a',
      facts: [{ id: 'f1', subject: 'repo', predicate: 'has', value: 'tests' }],
      decisions: [{ id: 'd1', question: 'Use lint?', answer: 'yes' }],
      constraints: [{ id: 'c1', scope: 'process', rule: 'no-refactor' }],
      risks: [{ id: 'r1', title: 'deadline', probability: 'low', impact: 'medium' }],
      assumptions: [{ id: 'a1', statement: 'CI available', confidence: 0.8 }],
    });

    const delta = diffState(state, state);

    expect(delta.facts.added).toEqual([]);
    expect(delta.facts.removed).toEqual([]);
    expect(delta.facts.modified).toEqual([]);
    expect(delta.decisions.modified).toEqual([]);
    expect(delta.constraints.modified).toEqual([]);
    expect(delta.risks.modified).toEqual([]);
    expect(delta.assumptions.modified).toEqual([]);
    expect(delta.meta.collisions.soft).toEqual([]);
    expect(delta.meta.collisions.hard).toEqual([]);
  });

  it('is stable when array order changes', () => {
    const stateA = createState({
      revisionHash: 'hash-a',
      facts: [
        { id: 'f1', subject: 'repo', predicate: 'has', value: 'tests' },
        { id: 'f2', subject: 'repo', predicate: 'uses', value: 'ts' },
      ],
      decisions: [
        { id: 'd1', question: 'Target?', answer: 'v0.2' },
        { id: 'd2', question: 'Mode?', answer: 'review' },
      ],
    });

    const stateB = createState({
      revisionHash: 'hash-b',
      facts: [
        { id: 'f2', subject: 'repo', predicate: 'uses', value: 'ts' },
        { id: 'f1', subject: 'repo', predicate: 'has', value: 'tests' },
      ],
      decisions: [
        { id: 'd2', question: 'Mode?', answer: 'review' },
        { id: 'd1', question: 'Target?', answer: 'v0.2' },
      ],
    });

    const delta = diffState(stateA, stateB);

    expect(delta.facts.added).toEqual([]);
    expect(delta.facts.removed).toEqual([]);
    expect(delta.facts.modified).toEqual([]);
    expect(delta.decisions.added).toEqual([]);
    expect(delta.decisions.removed).toEqual([]);
    expect(delta.decisions.modified).toEqual([]);
  });

  it('reports decision.answer modifications', () => {
    const before = createState({
      revisionHash: 'hash-a',
      decisions: [{ id: 'd1', question: 'Ship?', answer: 'no', rationale: 'pending tests' }],
    });
    const after = createState({
      revisionHash: 'hash-b',
      decisions: [{ id: 'd1', question: 'Ship?', answer: 'yes', rationale: 'tests passed' }],
    });

    const delta = diffState(before, after);

    expect(delta.decisions.modified).toHaveLength(1);
    expect(delta.decisions.modified[0]?.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'answer', op: 'set', before: 'no', after: 'yes' })])
    );
  });

  it('handles soft collision deterministically when signature matches but values differ', () => {
    const duplicateA = { id: 'd1', question: 'Plan?', answer: 'A' };
    const duplicateB = { id: 'd1', question: 'Plan?', answer: 'B' };
    const target = createState({
      revisionHash: 'hash-target',
      decisions: [{ id: 'd1', question: 'Plan?', answer: 'B' }],
    });

    const source1 = createState({ revisionHash: 'hash-s1', decisions: [duplicateA, duplicateB] });
    const source2 = createState({ revisionHash: 'hash-s2', decisions: [duplicateB, duplicateA] });

    const delta1 = diffState(source1, target);
    const delta2 = diffState(source2, target);

    expect(delta1.decisions).toEqual(delta2.decisions);
    expect(delta1.meta.collisions.soft.some((entry) => entry.includes('|decisions|base|'))).toBe(true);
  });

  it('records hard collision for fully identical duplicate units', () => {
    const identical = { id: 'd1', question: 'Plan?', answer: 'A' };
    const source = createState({
      revisionHash: 'hash-s1',
      decisions: [identical, { ...identical }],
    });
    const target = createState({
      revisionHash: 'hash-s2',
      decisions: [{ ...identical }],
    });

    const delta = diffState(source, target);

    expect(delta.meta.collisions.hard.some((entry) => entry.includes('|decisions|base|'))).toBe(true);
  });
});
