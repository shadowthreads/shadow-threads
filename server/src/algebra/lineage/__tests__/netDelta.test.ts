import { describe, expect, it } from 'vitest';

import { stableHash } from '../../semanticDiff/key';
import { compressRevisionChain } from '../compressRevisionChain';
import { buildAncestorPath, computeNetDeltaBetweenRevisions } from '../netDelta';

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    manifest: {
      schemaVersion: 'tpkg-0.2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'Net Delta',
      capabilities: {
        applyModes: ['bootstrap', 'constrain', 'review'],
        conflictHandling: 'report_only',
      },
    },
    intent: {
      primary: 'lineage',
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

describe('lineage net delta', () => {
  it('from == to returns identity delta', () => {
    const r0 = makeRevision('r0', createPayload({ facts: [{ id: 'f-1', value: 'alpha' }] }));
    const index = { r0 };

    const net = computeNetDeltaBetweenRevisions('r0', 'r0', index);
    const expected = compressRevisionChain([r0]);

    expect(stableHash(net)).toBe(stableHash(expected));
  });

  it('simple chain returns compressed R0->R2 net delta', () => {
    const r0 = makeRevision('r0', createPayload({ facts: [{ id: 'f-1', value: 'a' }] }));
    const r1 = makeRevision('r1', createPayload({ facts: [{ id: 'f-1', value: 'b' }] }), { parentRevisionId: 'r0' });
    const r2 = makeRevision('r2', createPayload({ facts: [{ id: 'f-1', value: 'c' }] }), { parentRevisionId: 'r1' });
    const index = { r0, r1, r2 };

    const net = computeNetDeltaBetweenRevisions('r0', 'r2', index);
    const expected = compressRevisionChain([r0, r1, r2]);

    expect(stableHash(net)).toBe(stableHash(expected));
  });

  it('branch path from sibling to sibling fails with E_NO_PATH', () => {
    const r0 = makeRevision('r0', createPayload());
    const r1 = makeRevision('r1', createPayload(), { parentRevisionId: 'r0' });
    const r1b = makeRevision('r1b', createPayload(), { parentRevisionId: 'r0' });
    const index = { r0, r1, r1b };

    try {
      buildAncestorPath('r1', 'r1b', index);
      throw new Error('expected no-path error');
    } catch (error) {
      expect((error as any).code).toBe('E_NO_PATH');
      expect((error as Error).message).toBe('No ancestor path from fromId to toId');
    }
  });

  it('missing from/to revisions throw deterministic not-found errors', () => {
    const r0 = makeRevision('r0', createPayload());
    const index = { r0 };

    try {
      computeNetDeltaBetweenRevisions('missing-from', 'r0', index);
      throw new Error('expected missing-from error');
    } catch (error) {
      expect((error as any).code).toBe('E_REVISION_NOT_FOUND');
      expect((error as Error).message).toBe('Revision not found: fromId');
    }

    try {
      computeNetDeltaBetweenRevisions('r0', 'missing-to', index);
      throw new Error('expected missing-to error');
    } catch (error) {
      expect((error as any).code).toBe('E_REVISION_NOT_FOUND');
      expect((error as Error).message).toBe('Revision not found: toId');
    }
  });

  it('missing intermediate parent throws lineage not-found error', () => {
    const r0 = makeRevision('r0', createPayload());
    const r2 = makeRevision('r2', createPayload(), { parentRevisionId: 'missing-parent' });
    const index = { r0, r2 };

    try {
      computeNetDeltaBetweenRevisions('r0', 'r2', index);
      throw new Error('expected missing-lineage error');
    } catch (error) {
      expect((error as any).code).toBe('E_REVISION_NOT_FOUND');
      expect((error as Error).message).toBe('Revision not found in lineage');
    }
  });

  it('cycle detection throws E_REVISION_CYCLE and repeated calls are deterministic', () => {
    const a = makeRevision('a', createPayload(), { parentRevisionId: 'b' });
    const b = makeRevision('b', createPayload(), { parentRevisionId: 'a' });
    const index = { a, b };

    const run = () => {
      try {
        buildAncestorPath('a', 'b', index);
        throw new Error('expected cycle error');
      } catch (error) {
        expect((error as any).code).toBe('E_REVISION_CYCLE');
        expect((error as Error).message).toBe('Cycle detected in parentRevisionId chain');
        return stableHash({ code: (error as any).code, message: (error as Error).message });
      }
    };

    const h1 = run();
    const h2 = run();
    expect(h1).toBe(h2);
  });
});

