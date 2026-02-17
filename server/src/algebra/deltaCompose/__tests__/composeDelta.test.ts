import { describe, expect, it } from 'vitest';

import { computeUnitKey, stableHash, stableStringify } from '../../semanticDiff/key';
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

function findFirstDiffIndex(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : max;
}

describe('composeDelta hardening rules', () => {
  it('REMOVE result does not fabricate empty unit payload', () => {
    const before = { id: 'f-1', value: 'old' };
    const mid = { id: 'f-1', value: 'new' };
    const key = computeUnitKey('facts', before);

    const d1 = makeDelta({
      facts: {
        added: [],
        removed: [],
        modified: [
          {
            key,
            before,
            after: mid,
            changes: [{ path: 'value', op: 'set', before: 'old', after: 'new' }],
          },
        ],
      },
    });
    const d2 = makeDelta({
      facts: {
        added: [],
        removed: [{ key } as any],
        modified: [],
      },
    });

    const composed = composeDelta(d1, d2);
    expect(composed.facts.removed).toHaveLength(1);
    expect(composed.facts.removed[0].key).toBe(key);
    expect(Object.prototype.hasOwnProperty.call(composed.facts.removed[0], 'unit')).toBe(false);
  });

  it('ADD ∘ MODIFY uses all-or-nothing fallback when patch is unsafe', () => {
    const added = { question: 'Ship now?', answer: 'no' };
    const after = { question: 'Ship now?', answer: 'yes' };
    const key = computeUnitKey('decisions', added);

    const d1 = makeDelta({
      decisions: { added: [{ key, unit: added }], removed: [], modified: [] },
    });
    const d2 = makeDelta({
      decisions: {
        added: [],
        removed: [],
        modified: [
          {
            key,
            before: added,
            after,
            changes: [{ path: '__proto__.answer', op: 'set', before: 'no', after: 'yes' }],
          },
        ],
      },
    });

    const composed = composeDelta(d1, d2);
    expect(composed.decisions.added).toHaveLength(1);
    expect(composed.decisions.modified).toHaveLength(0);
    expect(composed.decisions.added[0].unit).toEqual(after);
  });

  it('throws E_DELTA_INVALID when fieldChange value is not JSON-safe', () => {
    const risk = { id: 'r-1', title: 'risk', tags: [] as unknown[] };
    const key = computeUnitKey('risks', risk);
    const d1 = makeDelta({});
    const d2 = makeDelta({
      risks: {
        added: [],
        removed: [],
        modified: [
          {
            key,
            before: risk,
            after: { ...risk, tags: [BigInt(1)] },
            changes: [{ path: 'tags', op: 'append', value: BigInt(1) }],
          },
        ],
      },
    });

    try {
      composeDelta(d1, d2);
      throw new Error('expected composeDelta to throw');
    } catch (error) {
      expect((error as any).code).toBe('E_DELTA_INVALID');
      expect((error as Error).message).toBe('Non JSON-safe value in fieldChange');
    }
  });

  it('keeps deterministic ordering for keys', () => {
    const factA = { id: 'f-a', value: 'A' };
    const factB = { id: 'f-b', value: 'B' };
    const keyA = computeUnitKey('facts', factA);
    const keyB = computeUnitKey('facts', factB);

    const d1 = makeDelta({
      facts: {
        added: [
          { key: keyB, unit: factB },
          { key: keyA, unit: factA },
        ],
        removed: [],
        modified: [],
      },
    });
    const d2 = makeDelta({});

    const composedA = composeDelta(d1, d2);
    const composedB = composeDelta(
      makeDelta({
        facts: {
          added: [
            { key: keyA, unit: factA },
            { key: keyB, unit: factB },
          ],
          removed: [],
          modified: [],
        },
      }),
      d2
    );

    // Phase-1 diagnostics conclusion:
    // previous instability came from early-returning identity branches that preserved caller array order.
    // now compose always normalizes domain outputs (sorted keys), so hash is stable.
    const a = stableStringify(composedA);
    const b = stableStringify(composedB);
    const firstDiff = findFirstDiffIndex(a, b);
    if (firstDiff !== -1) {
      const left = a.slice(Math.max(0, firstDiff - 40), Math.min(a.length, firstDiff + 40));
      const right = b.slice(Math.max(0, firstDiff - 40), Math.min(b.length, firstDiff + 40));
      throw new Error(`Deterministic ordering mismatch at index ${firstDiff}\nA: ${left}\nB: ${right}`);
    }
    expect(stableHash(composedA)).toBe(stableHash(composedB));
    const keys = composedA.facts.added.map((item) => item.key);
    expect(keys).toEqual([...keys].sort());
  });
});
