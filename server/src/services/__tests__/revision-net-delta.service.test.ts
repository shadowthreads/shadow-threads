import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyDelta } from '../../algebra/stateTransition/applyDelta';
import { stableHash } from '../../algebra/semanticDiff/key';
import { revisionToSemanticState } from '../task-package-revision-delta';

const { findManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
}));

vi.mock('../../utils/db', () => ({
  prisma: {
    taskPackageRevision: {
      findMany: findManyMock,
    },
  },
}));

import { computeRevisionNetDelta } from '../revision-net-delta.service';

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    manifest: {
      schemaVersion: 'tpkg-0.2',
      createdAt: '2026-02-17T00:00:00.000Z',
      updatedAt: '2026-02-17T00:00:00.000Z',
      title: 'Revision Net Delta Service',
      capabilities: {
        applyModes: ['bootstrap', 'constrain', 'review'],
        conflictHandling: 'report_only',
      },
    },
    intent: {
      primary: 'service net delta',
      successCriteria: [],
      nonGoals: [],
    },
    state: {
      facts: [],
      decisions: [],
      assumptions: [],
      openLoops: [],
    },
    constraints: {
      technical: [],
      process: [],
      policy: [],
    },
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
  payload: Record<string, unknown>,
  parentRevisionId: string | null = null
) {
  return {
    id,
    parentRevisionId,
    payload,
    revisionHash: `${id}-hash`,
    schemaVersion: 'tpkg-0.2',
  };
}

beforeEach(() => {
  findManyMock.mockReset();
});

describe('computeRevisionNetDelta', () => {
  it('computes net delta for ancestor chain and applies from R0 to R2', async () => {
    const r0 = makeRevision('r0', createPayload({ facts: [{ id: 'fact-1', value: 'A' }] }));
    const r1 = makeRevision('r1', createPayload({ facts: [{ id: 'fact-1', value: 'B' }] }), 'r0');
    const r2 = makeRevision('r2', createPayload({ facts: [{ id: 'fact-1', value: 'C' }] }), 'r1');

    findManyMock.mockResolvedValue([r2, r0, r1]);

    const delta = await computeRevisionNetDelta({
      taskPackageId: 'pkg-1',
      fromRevisionId: 'r0',
      toRevisionId: 'r2',
    });

    const s0 = revisionToSemanticState(r0);
    const s2 = revisionToSemanticState(r2);
    const transition = applyDelta(s0, delta, { mode: 'best_effort' });

    expect(stableHash(transition.nextState)).toBe(stableHash(s2));
    expect(transition.conflicts).toHaveLength(0);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { packageId: 'pkg-1' },
      })
    );
    expect((findManyMock.mock.calls[0][0] as { orderBy?: unknown }).orderBy).toBeUndefined();
  });

  it('computes cross-branch delta and applies from sibling branch to sibling branch', async () => {
    const r0 = makeRevision('r0', createPayload({ facts: [{ id: 'fact-1', value: 'ROOT' }] }));
    const r1 = makeRevision('r1', createPayload({ facts: [{ id: 'fact-1', value: 'LEFT' }] }), 'r0');
    const r2 = makeRevision('r2', createPayload({ facts: [{ id: 'fact-1', value: 'RIGHT' }] }), 'r0');

    findManyMock.mockResolvedValue([r1, r2, r0]);

    const delta = await computeRevisionNetDelta({
      taskPackageId: 'pkg-1',
      fromRevisionId: 'r1',
      toRevisionId: 'r2',
    });

    const s1 = revisionToSemanticState(r1);
    const s2 = revisionToSemanticState(r2);
    const transition = applyDelta(s1, delta, { mode: 'best_effort' });

    expect(stableHash(transition.nextState)).toBe(stableHash(s2));
    expect(transition.conflicts).toHaveLength(0);
  });

  it('throws deterministic service-level not-found errors', async () => {
    const r0 = makeRevision('r0', createPayload());
    findManyMock.mockResolvedValue([r0]);

    await expect(
      computeRevisionNetDelta({
        taskPackageId: 'pkg-1',
        fromRevisionId: 'missing-from',
        toRevisionId: 'r0',
      })
    ).rejects.toMatchObject({
      code: 'E_REVISION_NOT_FOUND',
      message: 'Revision not found: fromId',
    });

    await expect(
      computeRevisionNetDelta({
        taskPackageId: 'pkg-1',
        fromRevisionId: 'r0',
        toRevisionId: 'missing-to',
      })
    ).rejects.toMatchObject({
      code: 'E_REVISION_NOT_FOUND',
      message: 'Revision not found: toId',
    });
  });
});
