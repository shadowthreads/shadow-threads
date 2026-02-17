import { describe, expect, it } from 'vitest';

import { applyDelta } from '../stateTransition/applyDelta';
import { detectConflicts } from '../stateTransition/detectConflicts';
import { diffState } from '../semanticDiff/diffState';
import { computeUnitKey, stableHash } from '../semanticDiff/key';
import type { DomainName, SemanticDelta } from '../semanticDiff/types';

const DOMAIN_ORDER: DomainName[] = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];

function createState(overrides: Record<string, unknown> = {}) {
  return {
    manifest: {
      schemaVersion: 'tpkg-0.2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'Invariant State',
      capabilities: {
        applyModes: ['bootstrap', 'constrain', 'review'],
        conflictHandling: 'report_only',
      },
    },
    intent: {
      primary: 'verify deterministic algebra',
      successCriteria: [],
      nonGoals: [],
    },
    state: {
      facts: [],
      decisions: [],
      assumptions: [],
      openLoops: [],
    },
    interfaces: {
      apis: [],
      modules: [],
    },
    evidence: [],
    history: {
      origin: 'manual',
      revision: 0,
    },
    compat: {
      accepts: ['tpkg-0.1'],
      downgradeStrategy: 'lossy-allowed',
    },
    facts: [{ id: 'fact-1', value: 'baseline fact' }],
    decisions: [{ question: 'Ship now?', answer: 'no' }],
    constraints: [{ name: 'guard-1', rule: 'must pass review' }],
    risks: [{ id: 'risk-1', title: 'latency', probability: 'low', impact: 'medium' }],
    assumptions: [{ statement: 'api remains stable', confidence: 'medium' }],
    ...overrides,
  };
}

function emptyDelta(baseHash = 'base', targetHash = 'target'): SemanticDelta {
  return {
    schemaVersion: 'sdiff-0.1',
    base: { revisionHash: baseHash },
    target: { revisionHash: targetHash },
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
      collisions: {
        hard: [],
        soft: [],
      },
      counts: {},
    },
  };
}

function domainUnits(state: unknown, domain: DomainName): unknown[] {
  const record = state as Record<string, unknown>;
  return Array.isArray(record[domain]) ? (record[domain] as unknown[]) : [];
}

function expectEmptyDomainDelta(delta: SemanticDelta, domain: DomainName) {
  expect(delta[domain].added).toHaveLength(0);
  expect(delta[domain].removed).toHaveLength(0);
  expect(delta[domain].modified).toHaveLength(0);
  expect(delta.meta.counts[`${domain}.added`]).toBe(0);
  expect(delta.meta.counts[`${domain}.removed`]).toBe(0);
  expect(delta.meta.counts[`${domain}.modified`]).toBe(0);
}

describe('State Algebra invariants', () => {
  it('Inv1: diffState(S, S) is empty', () => {
    const state = createState();
    const delta = diffState(state, state);

    for (const domain of DOMAIN_ORDER) {
      expectEmptyDomainDelta(delta, domain);
    }
    expect(delta.meta.collisions.soft).toHaveLength(0);
    expect(delta.meta.collisions.hard).toHaveLength(0);
    expect(delta.meta.counts['collisions.soft']).toBe(0);
    expect(delta.meta.counts['collisions.hard']).toBe(0);
  });

  it('Inv2: applyDelta(S, emptyDelta) preserves S', () => {
    const state = createState();
    const delta = diffState(state, state);
    const result = applyDelta(state, delta, { mode: 'best_effort' });

    expect(stableHash(result.nextState)).toBe(stableHash(state));
    expect(result.conflicts).toHaveLength(0);
  });

  it('Inv3: deterministic transition on repeated execution', () => {
    const base = createState();
    const target = createState({
      facts: [
        { id: 'fact-1', value: 'baseline fact' },
        { id: 'fact-2', value: 'new fact' },
      ],
      decisions: [{ question: 'Ship now?', answer: 'yes' }],
    });
    const delta = diffState(base, target);

    const first = applyDelta(base, delta, { mode: 'best_effort' });
    const second = applyDelta(base, delta, { mode: 'best_effort' });

    expect(stableHash(first.nextState)).toBe(stableHash(second.nextState));
    expect(first.applied).toEqual(second.applied);
    expect(first.rejected).toEqual(second.rejected);
    expect(first.conflicts).toEqual(second.conflicts);
  });

  it('Inv4: best_effort rejects only conflicting items in a domain', () => {
    const existing = { question: 'Ship now?', answer: 'no' };
    const existingKey = computeUnitKey('decisions', existing);
    const newDecision = { question: 'Ship this sprint?', answer: 'yes' };
    const newKey = computeUnitKey('decisions', newDecision);

    const delta = emptyDelta();
    delta.decisions.added = [
      { key: existingKey, unit: existing },
      { key: newKey, unit: newDecision },
    ];

    const result = applyDelta(createState({ decisions: [existing] }), delta, { mode: 'best_effort' });
    const decisions = domainUnits(result.nextState, 'decisions');

    expect(decisions).toHaveLength(2);
    expect(result.applied.perDomain.decisions.added).toBe(1);
    expect(result.rejected.perDomain.decisions.added).toBe(1);
    expect(result.conflicts.some((item) => item.code === 'E_ADD_EXISTS' && item.domain === 'decisions')).toBe(true);
  });

  it('Inv5: strict mode rolls back entire domain on any conflict (vs best_effort)', () => {
    const existing = { question: 'Ship now?', answer: 'no' };
    const existingKey = computeUnitKey('decisions', existing);
    const newDecision = { question: 'Ship this sprint?', answer: 'yes' };
    const newKey = computeUnitKey('decisions', newDecision);

    const delta = emptyDelta();
    delta.decisions.added = [
      { key: existingKey, unit: existing },
      { key: newKey, unit: newDecision },
    ];

    const current = createState({ decisions: [existing] });
    const bestEffort = applyDelta(current, delta, { mode: 'best_effort' });
    const strict = applyDelta(current, delta, { mode: 'strict' });

    expect(domainUnits(bestEffort.nextState, 'decisions')).toHaveLength(2);
    expect(bestEffort.applied.perDomain.decisions.added).toBe(1);
    expect(bestEffort.rejected.perDomain.decisions.added).toBe(1);

    expect(domainUnits(strict.nextState, 'decisions')).toHaveLength(1);
    expect(strict.applied.perDomain.decisions.added).toBe(0);
    expect(strict.rejected.perDomain.decisions.added).toBe(2);
    expect(strict.conflicts.some((item) => item.code === 'E_ADD_EXISTS' && item.domain === 'decisions')).toBe(true);
  });

  it('Inv6: applyDelta output remains JSON-safe for stableHash', () => {
    const base = createState();
    const target = createState({
      facts: [
        { id: 'fact-1', value: 'baseline fact' },
        { id: 'fact-2', value: { kind: 'json', nested: { score: 1 }, tags: ['a', 'b'] } },
      ],
    });
    const delta = diffState(base, target);
    const result = applyDelta(base, delta, { mode: 'best_effort' });

    expect(() => stableHash(result.nextState)).not.toThrow();
  });

  it('Inv7: computeUnitKey defines uniqueness and duplicate keys are detectable', () => {
    const sameSigA = { question: 'Should release happen?', answer: 'yes', rationale: 'ready' };
    const sameSigB = { question: 'Should release happen?', answer: 'no', rationale: 'blocked' };
    const keyA = computeUnitKey('decisions', sameSigA);
    const keyB = computeUnitKey('decisions', sameSigB);
    expect(keyA).toBe(keyB);

    const duplicateState = createState({
      decisions: [sameSigA, sameSigB],
    });
    const duplicateConflicts = detectConflicts(duplicateState);
    expect(
      duplicateConflicts.some(
        (item) => item.code === 'E_DUPLICATE_KEY' && item.domain === 'decisions' && item.key === keyA
      )
    ).toBe(true);

    const base = createState();
    const target = createState({
      facts: [
        { id: 'fact-1', value: 'baseline fact' },
        { id: 'fact-2', value: 'new fact' },
      ],
      decisions: [
        { question: 'Ship now?', answer: 'yes' },
        { question: 'Ship this sprint?', answer: 'yes' },
      ],
      constraints: [
        { name: 'guard-1', rule: 'must pass review' },
        { name: 'guard-2', rule: 'must include tests' },
      ],
      risks: [
        { id: 'risk-1', title: 'latency', probability: 'low', impact: 'medium' },
        { id: 'risk-2', title: 'regression', probability: 'low', impact: 'low' },
      ],
      assumptions: [
        { statement: 'api remains stable', confidence: 'medium' },
        { statement: 'traffic stays flat', confidence: 'low' },
      ],
    });
    const delta = diffState(base, target);
    const result = applyDelta(base, delta, { mode: 'best_effort' });

    for (const domain of DOMAIN_ORDER) {
      const units = domainUnits(result.nextState, domain);
      const keys = units.map((unit) => computeUnitKey(domain, unit));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('Inv8: without conflicts, applyDelta(S, diffState(S, T)) reconstructs T', () => {
    const base = createState();
    const target = createState({
      facts: [
        { id: 'fact-1', value: 'baseline fact' },
        { id: 'fact-2', value: 'extra fact' },
      ],
      decisions: [{ question: 'Ship now?', answer: 'yes' }],
      constraints: [{ name: 'guard-1', rule: 'must pass review and tests' }],
      risks: [{ id: 'risk-1', title: 'latency', probability: 'low', impact: 'low' }],
      assumptions: [{ statement: 'api remains stable', confidence: 'high' }],
    });
    const delta = diffState(base, target);
    const result = applyDelta(base, delta, { mode: 'best_effort' });

    expect(result.conflicts).toHaveLength(0);
    expect(stableHash(result.nextState)).toBe(stableHash(target));
  });
});
