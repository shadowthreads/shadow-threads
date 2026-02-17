import { describe, expect, it } from 'vitest';

import { applyDelta } from '../../stateTransition/applyDelta';
import { composeDelta } from '../../deltaCompose/composeDelta';
import { diffState } from '../../semanticDiff/diffState';
import { stableHash } from '../../semanticDiff/key';
import type { SemanticDelta } from '../../semanticDiff/types';
import { compressRevisionChain } from '../compressRevisionChain';

const DOMAIN_ORDER = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'] as const;

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    manifest: {
      schemaVersion: 'tpkg-0.2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'Lineage Delta Compression',
      capabilities: {
        applyModes: ['bootstrap', 'constrain', 'review'],
        conflictHandling: 'report_only',
      },
    },
    intent: {
      primary: 'compress chain',
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

function makeRevision(
  id: string,
  payload: unknown,
  extra?: { parentRevisionId?: string | null; revisionHash?: string }
) {
  return {
    id,
    payload,
    parentRevisionId: extra?.parentRevisionId ?? null,
    revisionHash: extra?.revisionHash ?? `${id}-hash`,
  };
}

function makeIdentityDelta(revisionHash = ''): SemanticDelta {
  const counts: Record<string, number> = {};
  for (const domain of DOMAIN_ORDER) {
    counts[`${domain}.added`] = 0;
    counts[`${domain}.removed`] = 0;
    counts[`${domain}.modified`] = 0;
  }
  counts['collisions.soft'] = 0;
  counts['collisions.hard'] = 0;

  return {
    schemaVersion: 'sdiff-0.1',
    base: { revisionHash },
    target: { revisionHash },
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
        soft: [],
        hard: [],
      },
      counts,
    },
  };
}

describe('compressRevisionChain', () => {
  it('returns identity delta for empty or single revision', () => {
    const empty = compressRevisionChain([]);
    expect(stableHash(empty)).toBe(stableHash(makeIdentityDelta('')));

    const singleRevision = makeRevision('r0', createPayload(), { revisionHash: 'r0-hash' });
    const single = compressRevisionChain([singleRevision]);
    expect(stableHash(single)).toBe(stableHash(makeIdentityDelta('r0-hash')));
  });

  it('throws deterministic payload error when a revision payload is missing', () => {
    try {
      compressRevisionChain([{ id: 'r0' } as any]);
      throw new Error('expected payload missing error');
    } catch (error) {
      expect((error as any).code).toBe('E_REVISION_PAYLOAD_MISSING');
      expect((error as Error).message).toBe('Revision payload is required');
    }
  });

  it('for two revisions equals diffState(R0,R1)', () => {
    const r0 = makeRevision(
      'r0',
      createPayload({
        facts: [{ id: 'f-1', value: 'alpha' }],
      })
    );
    const r1 = makeRevision(
      'r1',
      createPayload({
        facts: [{ id: 'f-1', value: 'beta' }],
      }),
      { parentRevisionId: 'r0' }
    );

    const compressed = compressRevisionChain([r0, r1]);
    const expected = diffState(r0.payload, r1.payload);

    expect(stableHash(compressed)).toBe(stableHash(expected));
  });

  it('for three revisions equals composeDelta(diff(R0,R1), diff(R1,R2))', () => {
    const r0 = makeRevision(
      'r0',
      createPayload({
        facts: [{ id: 'f-1', value: 'alpha' }],
        decisions: [{ question: 'Ship?', answer: 'no' }],
      })
    );
    const r1 = makeRevision(
      'r1',
      createPayload({
        facts: [{ id: 'f-1', value: 'beta' }],
        decisions: [{ question: 'Ship?', answer: 'no' }],
      }),
      { parentRevisionId: 'r0' }
    );
    const r2 = makeRevision(
      'r2',
      createPayload({
        facts: [{ id: 'f-1', value: 'beta' }],
        decisions: [{ question: 'Ship?', answer: 'yes' }],
      }),
      { parentRevisionId: 'r1' }
    );

    const compressed = compressRevisionChain([r0, r1, r2]);
    const expected = composeDelta(diffState(r0.payload, r1.payload), diffState(r1.payload, r2.payload));

    expect(stableHash(compressed)).toBe(stableHash(expected));
  });

  it('apply equivalence: compressed delta matches sequential apply in no-conflict chain', () => {
    const r0Payload = createPayload({
      facts: [{ id: 'f-1', value: 'alpha' }],
      decisions: [{ question: 'Ship?', answer: 'no' }],
    });
    const r1Payload = createPayload({
      facts: [{ id: 'f-1', value: 'beta' }],
      decisions: [{ question: 'Ship?', answer: 'no' }],
    });
    const r2Payload = createPayload({
      facts: [{ id: 'f-1', value: 'gamma' }],
      decisions: [{ question: 'Ship?', answer: 'yes' }],
    });

    const r0 = makeRevision('r0', r0Payload);
    const r1 = makeRevision('r1', r1Payload, { parentRevisionId: 'r0' });
    const r2 = makeRevision('r2', r2Payload, { parentRevisionId: 'r1' });

    const total = compressRevisionChain([r0, r1, r2]);
    const seqD01 = diffState(r0Payload, r1Payload);
    const seqD12 = diffState(r1Payload, r2Payload);

    const left = applyDelta(r0Payload, total, { mode: 'best_effort' });
    const seq1 = applyDelta(r0Payload, seqD01, { mode: 'best_effort' });
    const right = applyDelta(seq1.nextState, seqD12, { mode: 'best_effort' });

    expect(left.conflicts).toHaveLength(0);
    expect(seq1.conflicts).toHaveLength(0);
    expect(right.conflicts).toHaveLength(0);
    expect(stableHash(left.nextState)).toBe(stableHash(right.nextState));
  });

  it('is deterministic for identical input chains', () => {
    const r0 = makeRevision('r0', createPayload({ facts: [{ id: 'f-1', value: 'a' }] }));
    const r1 = makeRevision(
      'r1',
      createPayload({ facts: [{ id: 'f-1', value: 'b' }] }),
      { parentRevisionId: 'r0' }
    );
    const chain = [r0, r1];

    const first = compressRevisionChain(chain);
    const second = compressRevisionChain(chain);

    expect(stableHash(first)).toBe(stableHash(second));
  });
});

