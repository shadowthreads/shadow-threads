import { describe, expect, it } from 'vitest';

import { stableHash } from '../../semanticDiff/key';
import { compressRevisionChain } from '../compressRevisionChain';
import { computeCrossBranchNetDelta } from '../crossBranchNetDelta';

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    manifest: {
      schemaVersion: 'tpkg-0.2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'Cross Branch Net Delta',
      capabilities: {
        applyModes: ['bootstrap', 'constrain', 'review'],
        conflictHandling: 'report_only',
      },
    },
    intent: {
      primary: 'cross branch lineage',
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

describe('computeCrossBranchNetDelta', () => {
  it('uses ancestor_path mode when from is ancestor of to', () => {
    const r0 = makeRevision('r0', createPayload({ facts: [{ id: 'f-1', value: 'A' }] }));
    const r1 = makeRevision('r1', createPayload({ facts: [{ id: 'f-1', value: 'B' }] }), { parentRevisionId: 'r0' });
    const r2 = makeRevision('r2', createPayload({ facts: [{ id: 'f-1', value: 'C' }] }), { parentRevisionId: 'r1' });
    const index = { r0, r1, r2 };

    const actual = computeCrossBranchNetDelta('r0', 'r2', index);
    const identity = compressRevisionChain([r0]);
    const expectedNet = compressRevisionChain([r0, r1, r2]);

    expect(actual.mode).toBe('ancestor_path');
    expect(actual.lcaId).toBe('r0');
    expect(stableHash(actual.deltaFromLcaToFrom)).toBe(stableHash(identity));
    expect(stableHash(actual.deltaFromLcaToTo)).toBe(stableHash(expectedNet));
    expect(stableHash(actual.deltaFromTo)).toBe(stableHash(expectedNet));
  });

  it('uses lca mode for sibling branches and returns branch deltas from lca', () => {
    const r0 = makeRevision('r0', createPayload({ facts: [{ id: 'f-1', value: 'root' }] }));
    const r1 = makeRevision('r1', createPayload({ facts: [{ id: 'f-1', value: 'left' }] }), { parentRevisionId: 'r0' });
    const r1b = makeRevision('r1b', createPayload({ facts: [{ id: 'f-1', value: 'right' }] }), { parentRevisionId: 'r0' });
    const index = { r0, r1, r1b };

    const actual = computeCrossBranchNetDelta('r1', 'r1b', index);
    const expectedFrom = compressRevisionChain([r0, r1]);
    const expectedTo = compressRevisionChain([r0, r1b]);

    expect(actual.mode).toBe('lca');
    expect(actual.lcaId).toBe('r0');
    expect(stableHash(actual.deltaFromLcaToFrom)).toBe(stableHash(expectedFrom));
    expect(stableHash(actual.deltaFromLcaToTo)).toBe(stableHash(expectedTo));
  });

  it('finds deepest valid LCA in a deeper tree', () => {
    const r0 = makeRevision('r0', createPayload({ facts: [{ id: 'f-1', value: 'root' }] }));
    const a = makeRevision('a', createPayload({ facts: [{ id: 'f-1', value: 'A' }] }), { parentRevisionId: 'r0' });
    const a1 = makeRevision('a1', createPayload({ facts: [{ id: 'f-1', value: 'A1' }] }), { parentRevisionId: 'a' });
    const b = makeRevision('b', createPayload({ facts: [{ id: 'f-1', value: 'B' }] }), { parentRevisionId: 'r0' });
    const b1 = makeRevision('b1', createPayload({ facts: [{ id: 'f-1', value: 'B1' }] }), { parentRevisionId: 'b' });
    const index = { r0, a, a1, b, b1 };

    const actual = computeCrossBranchNetDelta('a1', 'b1', index);
    expect(actual.mode).toBe('lca');
    expect(actual.lcaId).toBe('r0');
  });

  it('throws E_NO_COMMON_ANCESTOR for disjoint roots', () => {
    const r0 = makeRevision('r0', createPayload());
    const r1 = makeRevision('r1', createPayload(), { parentRevisionId: 'r0' });
    const x0 = makeRevision('x0', createPayload());
    const x1 = makeRevision('x1', createPayload(), { parentRevisionId: 'x0' });
    const index = { r0, r1, x0, x1 };

    try {
      computeCrossBranchNetDelta('r1', 'x1', index);
      throw new Error('expected E_NO_COMMON_ANCESTOR');
    } catch (error) {
      expect((error as any).code).toBe('E_NO_COMMON_ANCESTOR');
      expect((error as Error).message).toBe('No common ancestor between fromId and toId');
    }
  });

  it('throws deterministic not-found errors for missing from/to', () => {
    const r0 = makeRevision('r0', createPayload());
    const index = { r0 };

    try {
      computeCrossBranchNetDelta('missing-from', 'r0', index);
      throw new Error('expected missing from error');
    } catch (error) {
      expect((error as any).code).toBe('E_REVISION_NOT_FOUND');
      expect((error as Error).message).toBe('Revision not found: fromId');
    }

    try {
      computeCrossBranchNetDelta('r0', 'missing-to', index);
      throw new Error('expected missing to error');
    } catch (error) {
      expect((error as any).code).toBe('E_REVISION_NOT_FOUND');
      expect((error as Error).message).toBe('Revision not found: toId');
    }
  });

  it('throws E_REVISION_CYCLE when parent pointers form a cycle', () => {
    const a = makeRevision('a', createPayload(), { parentRevisionId: 'b' });
    const b = makeRevision('b', createPayload(), { parentRevisionId: 'a' });
    const leaf = makeRevision('leaf', createPayload());
    const index = { a, b, leaf };

    try {
      computeCrossBranchNetDelta('a', 'leaf', index);
      throw new Error('expected cycle error');
    } catch (error) {
      expect((error as any).code).toBe('E_REVISION_CYCLE');
      expect((error as Error).message).toBe('Cycle detected in parentRevisionId chain');
    }
  });

  it('is deterministic for repeated calls on identical input', () => {
    const r0 = makeRevision('r0', createPayload({ facts: [{ id: 'f-1', value: 'root' }] }));
    const r1 = makeRevision('r1', createPayload({ facts: [{ id: 'f-1', value: 'left' }] }), { parentRevisionId: 'r0' });
    const r1b = makeRevision('r1b', createPayload({ facts: [{ id: 'f-1', value: 'right' }] }), { parentRevisionId: 'r0' });
    const index = { r0, r1, r1b };

    const run = () => computeCrossBranchNetDelta('r1', 'r1b', index);
    const first = run();
    const second = run();

    expect(stableHash(first.deltaFromLcaToFrom)).toBe(stableHash(second.deltaFromLcaToFrom));
    expect(stableHash(first.deltaFromTo)).toBe(stableHash(second.deltaFromTo));
  });
});
