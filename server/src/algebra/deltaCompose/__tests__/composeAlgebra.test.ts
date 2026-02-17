import { describe, expect, it } from 'vitest';

import { applyDelta } from '../../stateTransition/applyDelta';
import { computeUnitKey, stableHash } from '../../semanticDiff/key';
import type { DomainName, SemanticDelta } from '../../semanticDiff/types';
import { composeDelta } from '../composeDelta';

const DOMAIN_ORDER: DomainName[] = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];

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
        tieBreakers: ['test'],
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
  return makeDelta({ baseHash: hash, targetHash: hash });
}

function createBaseState(overrides: Record<string, unknown> = {}) {
  return {
    manifest: {
      schemaVersion: 'tpkg-0.2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'Compose Algebra Base',
      capabilities: {
        applyModes: ['bootstrap', 'constrain', 'review'],
        conflictHandling: 'report_only',
      },
    },
    intent: {
      primary: 'compose algebra',
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

describe('Delta composition algebra properties', () => {
  it('P1: identity element exists for composition', () => {
    const fact = { id: 'f-1', value: 'alpha' };
    const key = computeUnitKey('facts', fact);
    const delta = makeDelta({
      baseHash: 'h0',
      targetHash: 'h1',
      facts: { added: [{ key, unit: fact }], removed: [], modified: [] },
    });

    expect(stableHash(composeDelta(delta, makeIdentityDelta(delta.target.revisionHash)))).toBe(stableHash(delta));
    expect(stableHash(composeDelta(makeIdentityDelta(delta.base.revisionHash), delta))).toBe(stableHash(delta));
  });

  it('P2: composition remains associative across add/modify/remove overlap', () => {
    const start = { question: 'Ship now?', answer: 'no', tags: ['a'] };
    const updated = { question: 'Ship now?', answer: 'yes', tags: ['a', 'b'] };
    const readded = { question: 'Ship now?', answer: 'maybe', tags: ['z'] };
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
            after: updated,
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
        added: [{ key, unit: readded }],
        removed: [{ key } as any],
        modified: [],
      },
    });

    const left = composeDelta(composeDelta(d1, d2), d3);
    const right = composeDelta(d1, composeDelta(d2, d3));

    expect(stableHash(left)).toBe(stableHash(right));
  });

  it('P3: compose/apply homomorphism under no-conflict precondition', () => {
    const baseState = createBaseState({ facts: [] });
    const factA = { id: 'f-1', value: 'a' };
    const factB = { id: 'f-1', value: 'b' };
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
            changes: [{ path: 'value', op: 'set', before: 'a', after: 'b' }],
          },
        ],
      },
    });

    const composed = composeDelta(d1, d2);
    const left = applyDelta(baseState, composed, { mode: 'best_effort' });
    const mid = applyDelta(baseState, d1, { mode: 'best_effort' });
    const right = applyDelta(mid.nextState, d2, { mode: 'best_effort' });

    expect(left.conflicts).toHaveLength(0);
    expect(mid.conflicts).toHaveLength(0);
    expect(right.conflicts).toHaveLength(0);
    expect(stableHash(left.nextState)).toBe(stableHash(right.nextState));
  });
});

