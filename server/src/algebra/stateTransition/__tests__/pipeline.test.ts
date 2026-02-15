import { describe, expect, it, vi } from 'vitest';

import { computeUnitKey, stableHash } from '../../semanticDiff/key';
import type { SemanticDelta } from '../../semanticDiff/types';
import { computeNextStateFromRevisions } from '../pipeline';
import * as revisionDeltaModule from '../../../services/task-package-revision-delta';

function createV2Payload(overrides: Record<string, unknown> = {}) {
  return {
    revisionHash: 'rev-hash-1',
    manifest: {
      schemaVersion: 'tpkg-0.2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'Task Package',
      capabilities: {
        applyModes: ['bootstrap', 'constrain', 'review'],
        conflictHandling: 'report_only',
      },
    },
    intent: {
      primary: 'Move task forward',
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
    ...overrides,
  };
}

function emptyDelta(): SemanticDelta {
  return {
    schemaVersion: 'sdiff-0.1',
    base: { revisionHash: 'base' },
    target: { revisionHash: 'target' },
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
      collisions: { soft: [], hard: [] },
      counts: {},
    },
  };
}

describe('computeNextStateFromRevisions', () => {
  it('returns empty delta and semantic-equivalent nextState when base equals target', () => {
    const payload = createV2Payload({
      facts: [{ id: 'f-1', value: 'fact' }],
      decisions: [{ id: 'd-1', question: 'Ship?', answer: 'no' }],
    });

    const result = computeNextStateFromRevisions({ payload }, { payload });
    const normalizedBase = revisionDeltaModule.revisionToSemanticState({ payload });

    expect(result.deltaSummary.modifiedDomains).toEqual([]);
    expect(stableHash(result.transition.nextState)).toBe(stableHash(normalizedBase));
  });

  it('applies decision.answer change through delta + transition pipeline', () => {
    const base = createV2Payload({
      decisions: [{ id: 'd-1', question: 'Ship?', answer: 'no' }],
      state: {
        facts: [],
        decisions: ['Ship?'],
        assumptions: [],
        openLoops: [],
      },
    });

    const target = createV2Payload({
      decisions: [{ id: 'd-1', question: 'Ship?', answer: 'yes' }],
      state: {
        facts: [],
        decisions: ['Ship?'],
        assumptions: [],
        openLoops: [],
      },
    });

    const result = computeNextStateFromRevisions({ payload: base }, { payload: target });

    expect(result.delta.decisions.modified).toHaveLength(1);
    expect((result.transition.nextState as any).decisions[0]?.answer).toBe('yes');
  });

  it('rolls back conflicting domain in strict mode', () => {
    const existingDecision = { key: 'existing', question: 'Existing?', answer: 'no' };
    const existingKey = computeUnitKey('decisions', existingDecision);
    const conflictingDelta = emptyDelta();
    conflictingDelta.decisions.added = [
      {
        key: existingKey,
        unit: existingDecision,
      },
      {
        key: computeUnitKey('decisions', { key: 'new', question: 'New?', answer: 'yes' }),
        unit: { question: 'New?', answer: 'yes' },
      },
    ];

    const deltaSpy = vi
      .spyOn(revisionDeltaModule, 'computeRevisionDelta')
      .mockReturnValue(conflictingDelta);

    const base = createV2Payload({
      decisions: [existingDecision],
    });
    const target = createV2Payload();

    const result = computeNextStateFromRevisions(
      { payload: base },
      { payload: target },
      { transitionMode: 'strict' }
    );

    expect((result.transition.nextState as any).decisions).toHaveLength(1);
    expect(result.transition.applied.perDomain.decisions.added).toBe(0);
    expect(result.transition.rejected.perDomain.decisions.added).toBe(2);
    expect(result.transition.conflicts.some((item) => item.code === 'E_ADD_EXISTS')).toBe(true);

    deltaSpy.mockRestore();
  });

  it('throws E_CONFLICTS_PRESENT when failOnConflicts is enabled', () => {
    const base = createV2Payload({
      decisions: [{ question: 'Ship?', final: true }],
      state: {
        facts: [],
        decisions: ['Ship?'],
        assumptions: [],
        openLoops: [],
      },
    });
    const target = base;

    expect(() =>
      computeNextStateFromRevisions(
        { payload: base },
        { payload: target },
        { failOnConflicts: true }
      )
    ).toThrowError(expect.objectContaining({ code: 'E_CONFLICTS_PRESENT' }));
  });
});
