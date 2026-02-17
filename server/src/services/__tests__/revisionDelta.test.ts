import { describe, expect, it } from 'vitest';

import { computeRevisionDelta, summarizeDelta } from '../task-package-revision-delta';

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
    ...overrides,
  };
}

function createV1Payload(overrides: Record<string, unknown> = {}) {
  return {
    revisionHash: 'rev-hash-1',
    manifest: {
      schemaVersion: 'tpkg-0.1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'Task Package',
    },
    intent: {
      text: 'Move task forward',
    },
    state: {
      facts: [],
      decisions: [],
      assumptions: [],
      openLoops: [],
    },
    constraints: {
      interfaces: [],
    },
    risks: [],
    evidence: [],
    ...overrides,
  };
}

function expectDomainEmpty(domain: { added: unknown[]; removed: unknown[]; modified: unknown[] }) {
  expect(domain.added).toEqual([]);
  expect(domain.removed).toEqual([]);
  expect(domain.modified).toEqual([]);
}

describe('computeRevisionDelta', () => {
  it('returns empty delta for same revision payload', () => {
    const payload = createV2Payload({
      state: {
        facts: ['fact-1'],
        decisions: ['decision-1'],
        assumptions: ['assumption-1'],
        openLoops: ['loop-1'],
      },
    });

    const delta = computeRevisionDelta({ payload }, { payload });

    expectDomainEmpty(delta.facts);
    expectDomainEmpty(delta.decisions);
    expectDomainEmpty(delta.constraints);
    expectDomainEmpty(delta.risks);
    expectDomainEmpty(delta.assumptions);
    expect(Object.values(delta.meta.counts).every((count) => count === 0)).toBe(true);
  });

  it('reuses normalizeTaskPackagePayload for v0.1 vs equivalent v0.2 payloads', () => {
    const v1Payload = createV1Payload({
      state: {
        facts: ['fact-1'],
        decisions: ['decision-1'],
        assumptions: ['assumption-1'],
        openLoops: ['loop-1'],
      },
    });

    const v2Payload = createV2Payload({
      state: {
        facts: ['fact-1'],
        decisions: ['decision-1'],
        assumptions: ['assumption-1'],
        openLoops: ['loop-1'],
      },
    });

    const delta = computeRevisionDelta(
      { payload: v1Payload, schemaVersion: 'tpkg-0.1' },
      { payload: v2Payload, schemaVersion: 'tpkg-0.2' }
    );

    expectDomainEmpty(delta.facts);
    expectDomainEmpty(delta.decisions);
    expectDomainEmpty(delta.constraints);
    expectDomainEmpty(delta.risks);
    expectDomainEmpty(delta.assumptions);
  });

  it('captures decision.answer modification as a set change', () => {
    const decisionBase = { id: 'd-1', question: 'Ship now?', answer: 'no', rationale: 'pending review', confidence: 0.7 };
    const decisionTarget = { ...decisionBase, answer: 'yes' };

    const payloadA = createV2Payload({
      decisions: [decisionBase],
      state: {
        facts: [],
        decisions: ['Ship now?'],
        assumptions: [],
        openLoops: [],
      },
    });

    const payloadB = createV2Payload({
      decisions: [decisionTarget],
      state: {
        facts: [],
        decisions: ['Ship now?'],
        assumptions: [],
        openLoops: [],
      },
    });

    const delta = computeRevisionDelta({ payload: payloadA }, { payload: payloadB });

    expect(delta.decisions.modified).toHaveLength(1);
    expect(delta.decisions.modified[0]?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'answer',
          op: 'set',
          before: 'no',
          after: 'yes',
        }),
      ])
    );
  });

  it('summarizeDelta returns stable modifiedDomains ordering', () => {
    const payloadA = createV2Payload({
      decisions: [{ id: 'd-1', question: 'Q?', answer: 'no' }],
      risks: [{ id: 'r-1', title: 'risk-a', probability: 'low', impact: 'medium' }],
      state: { facts: [], decisions: ['Q?'], assumptions: [], openLoops: [] },
    });
    const payloadB = createV2Payload({
      decisions: [{ id: 'd-1', question: 'Q?', answer: 'yes' }],
      risks: [{ id: 'r-2', title: 'risk-b', probability: 'high', impact: 'high' }],
      state: { facts: [], decisions: ['Q?'], assumptions: [], openLoops: [] },
    });

    const delta = computeRevisionDelta({ payload: payloadA }, { payload: payloadB });
    const summary = summarizeDelta(delta);

    expect(summary.modifiedDomains).toEqual(['decisions', 'risks']);
    expect(summary.counts.decisions.modified).toBe(1);
    expect(summary.counts.risks.added + summary.counts.risks.removed + summary.counts.risks.modified).toBeGreaterThan(0);
  });

  it('throws E_PAYLOAD_MISSING when payload is missing', () => {
    expect(() => computeRevisionDelta({} as any, { payload: createV2Payload() })).toThrowError(
      expect.objectContaining({ code: 'E_PAYLOAD_MISSING' })
    );
  });

  it('throws deterministic invalid payload error for non JSON-safe values', () => {
    const badPayload = createV2Payload({
      decisions: [{ id: 'd-1', question: 'Q?', answer: BigInt(1) }],
    });
    expect(() => computeRevisionDelta({ payload: badPayload }, { payload: createV2Payload() })).toThrowError(
      expect.objectContaining({ code: 'E_PAYLOAD_INVALID' })
    );
  });
});
