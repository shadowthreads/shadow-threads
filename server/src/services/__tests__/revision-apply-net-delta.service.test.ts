import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { applyRevisionNetDelta } from '../revision-apply-net-delta.service';

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    manifest: {
      schemaVersion: 'tpkg-0.2',
      createdAt: '2026-02-17T00:00:00.000Z',
      updatedAt: '2026-02-17T00:00:00.000Z',
      title: 'Revision Apply Net Delta',
      capabilities: {
        applyModes: ['bootstrap', 'constrain', 'review'],
        conflictHandling: 'report_only',
      },
    },
    intent: {
      primary: 'apply revision net delta',
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
    constraints: [],
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

describe('applyRevisionNetDelta', () => {
  it('applies ancestor chain net delta from R0 to R2', async () => {
    const r0 = makeRevision('r0', createPayload({ facts: [{ id: 'fact-1', value: 'A' }] }));
    const r1 = makeRevision('r1', createPayload({ facts: [{ id: 'fact-1', value: 'B' }] }), 'r0');
    const r2 = makeRevision('r2', createPayload({ facts: [{ id: 'fact-1', value: 'C' }] }), 'r1');
    findManyMock.mockResolvedValue([r2, r0, r1]);

    const result = await applyRevisionNetDelta({
      taskPackageId: 'pkg-1',
      fromRevisionId: 'r0',
      toRevisionId: 'r2',
    });

    const expectedToState = revisionToSemanticState(r2);
    expect(stableHash(result.transition.nextState)).toBe(stableHash(expectedToState));
    expect(result.transition.conflicts).toHaveLength(0);

    const callArg = findManyMock.mock.calls[0][0] as { orderBy?: unknown };
    expect(callArg).not.toHaveProperty('orderBy');
  });

  it('applies sibling cross-branch net delta from R1 to R2', async () => {
    const r0 = makeRevision('r0', createPayload({ facts: [{ id: 'fact-1', value: 'ROOT' }] }));
    const r1 = makeRevision('r1', createPayload({ facts: [{ id: 'fact-1', value: 'LEFT' }] }), 'r0');
    const r2 = makeRevision('r2', createPayload({ facts: [{ id: 'fact-1', value: 'RIGHT' }] }), 'r0');
    findManyMock.mockResolvedValue([r1, r2, r0]);

    const result = await applyRevisionNetDelta({
      taskPackageId: 'pkg-1',
      fromRevisionId: 'r1',
      toRevisionId: 'r2',
    });

    const expectedToState = revisionToSemanticState(r2);
    expect(stableHash(result.transition.nextState)).toBe(stableHash(expectedToState));
    expect(result.transition.conflicts).toHaveLength(0);
  });

  it('throws strict conflict error when transition contains conflicts', async () => {
    const r0 = makeRevision('r0', createPayload({ constraints: [] }));
    const r1 = makeRevision(
      'r1',
      createPayload({ constraints: [{ name: 'c1', rule: '' }] }),
      'r0'
    );
    findManyMock.mockResolvedValue([r1, r0]);

    await expect(
      applyRevisionNetDelta({
        taskPackageId: 'pkg-1',
        fromRevisionId: 'r0',
        toRevisionId: 'r1',
        mode: 'strict',
      })
    ).rejects.toMatchObject({
      code: 'E_REVISION_NET_DELTA_CONFLICT',
      message: 'Revision net delta contains conflicts',
    });
  });

  it('is deterministic for repeated runs on the same input', async () => {
    const r0 = makeRevision('r0', createPayload({ facts: [{ id: 'fact-1', value: 'A' }] }));
    const r1 = makeRevision('r1', createPayload({ facts: [{ id: 'fact-1', value: 'B' }] }), 'r0');
    const r2 = makeRevision('r2', createPayload({ facts: [{ id: 'fact-1', value: 'C' }] }), 'r1');
    findManyMock.mockResolvedValue([r2, r0, r1]);

    const first = await applyRevisionNetDelta({
      taskPackageId: 'pkg-1',
      fromRevisionId: 'r0',
      toRevisionId: 'r2',
    });
    const second = await applyRevisionNetDelta({
      taskPackageId: 'pkg-1',
      fromRevisionId: 'r0',
      toRevisionId: 'r2',
    });

    expect(first.stateHashAfter).toBe(second.stateHashAfter);
    expect(first.deltaSummary).toEqual(second.deltaSummary);
  });
});
