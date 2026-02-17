import { describe, expect, it } from 'vitest';

import { composeDelta } from '../deltaCompose/composeDelta';
import { applyDelta } from '../stateTransition/applyDelta';
import { computeUnitKey, stableHash } from '../semanticDiff/key';
import type { DomainName, SemanticDelta } from '../semanticDiff/types';

const DOMAIN_ORDER: DomainName[] = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];
const DOMAIN_RANK = new Map<DomainName, number>(DOMAIN_ORDER.map((domain, index) => [domain, index]));

function makeDelta(
  init?: Partial<Omit<SemanticDelta, 'schemaVersion' | 'base' | 'target' | 'meta'>> & {
    baseHash?: string;
    targetHash?: string;
  }
): SemanticDelta {
  const delta: SemanticDelta = {
    schemaVersion: 'sdiff-0.1',
    base: { revisionHash: init?.baseHash ?? 'base' },
    target: { revisionHash: init?.targetHash ?? 'target' },
    facts: { added: [], removed: [], modified: [] },
    decisions: { added: [], removed: [], modified: [] },
    constraints: { added: [], removed: [], modified: [] },
    risks: { added: [], removed: [], modified: [] },
    assumptions: { added: [], removed: [], modified: [] },
    meta: {
      determinism: {
        canonicalVersion: 'tpkg-0.2-canon-v1',
        keyStrategy: 'sig-hash-v1',
        tieBreakers: ['algebra-closure-test'],
      },
      collisions: { soft: [], hard: [] },
      counts: {},
    },
  };

  for (const domain of DOMAIN_ORDER) {
    if (init?.[domain]) delta[domain] = init[domain]!;
    delta.meta.counts[`${domain}.added`] = delta[domain].added.length;
    delta.meta.counts[`${domain}.removed`] = delta[domain].removed.length;
    delta.meta.counts[`${domain}.modified`] = delta[domain].modified.length;
  }
  delta.meta.counts['collisions.soft'] = 0;
  delta.meta.counts['collisions.hard'] = 0;

  return delta;
}

function makeIdentityDelta(hash: string): SemanticDelta {
  return makeDelta({
    baseHash: hash,
    targetHash: hash,
  });
}

function createBaseState(overrides: Record<string, unknown> = {}) {
  return {
    manifest: {
      schemaVersion: 'tpkg-0.2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'Algebra Closure',
      capabilities: {
        applyModes: ['bootstrap', 'constrain', 'review'],
        conflictHandling: 'report_only',
      },
    },
    intent: {
      primary: 'closure test',
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
    facts: [],
    decisions: [],
    constraints: [],
    risks: [],
    assumptions: [],
    ...overrides,
  };
}

function conflictSort(a: { domain: DomainName; code: string; key?: string; path?: string; message: string }, b: typeof a): number {
  return (
    (DOMAIN_RANK.get(a.domain) ?? 0) - (DOMAIN_RANK.get(b.domain) ?? 0) ||
    a.code.localeCompare(b.code) ||
    (a.key ?? '').localeCompare(b.key ?? '') ||
    (a.path ?? '').localeCompare(b.path ?? '') ||
    a.message.localeCompare(b.message)
  );
}

describe('Algebra closure (S, D, o, F)', () => {
  it('identity delta e is left/right identity for nontrivial delta', () => {
    const fact = { id: 'f-1', value: 'alpha' };
    const factKey = computeUnitKey('facts', fact);
    const decisionBefore = { question: 'Ship now?', answer: 'no' };
    const decisionAfter = { question: 'Ship now?', answer: 'yes' };
    const decisionKey = computeUnitKey('decisions', decisionBefore);

    const d = makeDelta({
      baseHash: 'h0',
      targetHash: 'h1',
      facts: { added: [{ key: factKey, unit: fact }], removed: [], modified: [] },
      decisions: {
        added: [],
        removed: [],
        modified: [
          {
            key: decisionKey,
            before: decisionBefore,
            after: decisionAfter,
            changes: [{ path: 'answer', op: 'set', before: 'no', after: 'yes' }],
          },
        ],
      },
      assumptions: {
        added: [],
        removed: [{ key: computeUnitKey('assumptions', { statement: 'old-assumption' }) } as any],
        modified: [],
      },
    });

    const leftIdentity = makeIdentityDelta(d.base.revisionHash);
    const rightIdentity = makeIdentityDelta(d.target.revisionHash);

    expect(stableHash(composeDelta(leftIdentity, d))).toBe(stableHash(d));
    expect(stableHash(composeDelta(d, rightIdentity))).toBe(stableHash(d));
  });

  it('associativity holds under overlapping keys and overlapping changes', () => {
    const start = { question: 'Deploy?', answer: 'no', tags: ['a'] };
    const mid = { question: 'Deploy?', answer: 'yes', tags: ['a', 'b'] };
    const end = { question: 'Deploy?', answer: 'maybe', tags: ['b'] };
    const key = computeUnitKey('decisions', start);

    const d1 = makeDelta({
      baseHash: 'h0',
      targetHash: 'h1',
      decisions: { added: [{ key, unit: start }], removed: [], modified: [] },
    });
    const d2 = makeDelta({
      baseHash: 'h1',
      targetHash: 'h2',
      decisions: {
        added: [],
        removed: [],
        modified: [
          {
            key,
            before: start,
            after: mid,
            changes: [
              { path: 'answer', op: 'set', before: 'no', after: 'yes' },
              { path: 'tags', op: 'append', value: 'b' },
            ],
          },
        ],
      },
    });
    const d3 = makeDelta({
      baseHash: 'h2',
      targetHash: 'h3',
      decisions: {
        added: [{ key, unit: end }],
        removed: [{ key } as any],
        modified: [],
      },
    });

    const left = composeDelta(composeDelta(d1, d2), d3);
    const right = composeDelta(d1, composeDelta(d2, d3));

    expect(stableHash(left)).toBe(stableHash(right));
  });

  it('homomorphism holds for best_effort under no-conflict precondition', () => {
    const state = createBaseState();
    const factA = { id: 'f-1', value: 'alpha' };
    const factB = { id: 'f-1', value: 'beta' };
    const key = computeUnitKey('facts', factA);

    const d1 = makeDelta({
      baseHash: 'h0',
      targetHash: 'h1',
      facts: { added: [{ key, unit: factA }], removed: [], modified: [] },
    });
    const d2 = makeDelta({
      baseHash: 'h1',
      targetHash: 'h2',
      facts: {
        added: [],
        removed: [],
        modified: [
          {
            key,
            before: factA,
            after: factB,
            changes: [{ path: 'value', op: 'set', before: 'alpha', after: 'beta' }],
          },
        ],
      },
    });

    const composed = composeDelta(d1, d2);
    const left = applyDelta(state, composed, { mode: 'best_effort' });
    const seq1 = applyDelta(state, d1, { mode: 'best_effort' });
    const right = applyDelta(seq1.nextState, d2, { mode: 'best_effort' });

    expect(left.conflicts).toHaveLength(0);
    expect(seq1.conflicts).toHaveLength(0);
    expect(right.conflicts).toHaveLength(0);
    expect(stableHash(left.nextState)).toBe(stableHash(right.nextState));
  });

  it('meta-non-neutral empty delta is NOT identity by definition', () => {
    const fact = { id: 'f-2', value: 'x' };
    const d = makeDelta({
      baseHash: 'h0',
      targetHash: 'h1',
      facts: { added: [{ key: computeUnitKey('facts', fact), unit: fact }], removed: [], modified: [] },
    });
    const ePrime = makeIdentityDelta(d.base.revisionHash);
    ePrime.meta.collisions.soft = ['meta-non-neutral'];
    ePrime.meta.counts['collisions.soft'] = 1;

    expect(stableHash(composeDelta(ePrime, d))).not.toBe(stableHash(d));
  });

  it('conflict surface ordering remains deterministic', () => {
    const existingDecision = { question: 'Ship now?', answer: 'no' };
    const existingDecisionKey = computeUnitKey('decisions', existingDecision);
    const state = createBaseState({ decisions: [existingDecision] });

    const delta = makeDelta({
      facts: {
        added: [],
        removed: [{ key: computeUnitKey('facts', { id: 'missing-fact', value: 'x' }) } as any],
        modified: [],
      },
      decisions: {
        added: [{ key: existingDecisionKey, unit: existingDecision }],
        removed: [],
        modified: [],
      },
      constraints: {
        added: [],
        removed: [],
        modified: [
          {
            key: computeUnitKey('constraints', { name: 'missing-c', rule: 'r1' }),
            before: { name: 'missing-c', rule: 'r1' },
            after: { name: 'missing-c', rule: 'r2' },
            changes: [{ path: 'rule', op: 'set', before: 'r1', after: 'r2' }],
          },
        ],
      },
    });

    const result = applyDelta(state, delta, { mode: 'best_effort' });
    const expected = [...result.conflicts].sort(conflictSort);
    expect(result.conflicts).toEqual(expected);
  });
});

