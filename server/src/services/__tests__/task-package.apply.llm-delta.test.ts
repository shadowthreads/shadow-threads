import { afterEach, describe, expect, it, vi } from 'vitest';

import { diffState } from '../../algebra/semanticDiff/diffState';
import { parseLLMDelta } from '../llm-delta-parser';
import { revisionToSemanticState, type RevisionLike } from '../task-package-revision-delta';
import { TaskPackageService } from '../task-package.service';

function createPayload(overrides?: Record<string, unknown>): Record<string, unknown> {
  const base = {
    manifest: {
      schemaVersion: 'tpkg-0.2',
      createdAt: '2026-02-17T00:00:00.000Z',
      updatedAt: '2026-02-17T00:00:00.000Z',
      title: 'LLM Delta Apply Test',
      capabilities: {
        applyModes: ['bootstrap', 'constrain', 'review'],
        conflictHandling: 'report_only',
      },
    },
    intent: {
      primary: 'Apply deterministic delta',
      successCriteria: [],
      nonGoals: [],
    },
    state: {
      facts: ['fact-a'],
      decisions: ['decision-a'],
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
      revision: 1,
    },
    compat: {
      accepts: ['tpkg-0.1'],
      downgradeStrategy: 'lossy-allowed',
    },
    facts: [{ id: 'fact-a', value: 'keep' }],
    decisions: [{ question: 'Ship now?', answer: 'yes' }],
    constraints: [{ name: 'c1', rule: 'must-keep' }],
    risks: [],
    assumptions: [],
  } as Record<string, unknown>;

  return {
    ...base,
    ...overrides,
  };
}

function createOwnedPackage(payload: Record<string, unknown>) {
  return {
    id: 'pkg-1',
    sourceSnapshotId: null,
    currentRevision: {
      id: 'rev-1',
      rev: 1,
      schemaVersion: 'tpkg-0.2',
      revisionHash: 'current-revision-hash',
      payload,
    },
  };
}

function setupService(payload: Record<string, unknown>, llmContent: string) {
  const service = new TaskPackageService();
  vi.spyOn(service as any, 'getOwned').mockResolvedValue(createOwnedPackage(payload));
  const llmSpy = vi.spyOn((service as any).llmService, 'complete').mockResolvedValue({
    content: llmContent,
  });
  const apiKeySpy = vi.spyOn((service as any).userService, 'getDecryptedApiKey').mockResolvedValue('dummy-key');

  return { service, llmSpy, apiKeySpy };
}

function makeRevisionLike(payload: Record<string, unknown>): RevisionLike {
  return {
    payload,
    schemaVersion: 'tpkg-0.2',
    revisionHash: typeof payload.revisionHash === 'string' ? payload.revisionHash : undefined,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TaskPackageService.applyPackage llmMode=delta', () => {
  it('delta mode applies parsed llm delta and reports deterministic llmDelta summary', async () => {
    const basePayload = createPayload({
      decisions: [{ question: 'Ship now?', answer: 'yes' }],
    });
    const nextPayload = createPayload({
      decisions: [{ question: 'Ship now?', answer: 'no' }],
    });

    const baseState = revisionToSemanticState(makeRevisionLike(basePayload));
    const nextState = revisionToSemanticState(makeRevisionLike(nextPayload));
    const llmDelta = diffState(baseState, nextState);

    const { service, llmSpy, apiKeySpy } = setupService(basePayload, JSON.stringify(llmDelta));

    const result = await service.applyPackage(
      'user-1',
      'pkg-1',
      {
        userQuestion: 'Update the decision',
        mode: 'review',
      },
      { llmMode: 'delta' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(llmSpy).toHaveBeenCalledTimes(1);
    expect(apiKeySpy).toHaveBeenCalledTimes(1);

    const llmDeltaReport = result.data.applyReport.llmDelta;
    expect(llmDeltaReport).toBeDefined();
    expect(llmDeltaReport.mode).toBe('delta');
    expect(llmDeltaReport.stateHashAfter).not.toBe(llmDeltaReport.stateHashBefore);
    expect(llmDeltaReport.deltaSummary.modifiedDomains).toContain('decisions');
  });

  it('parseLLMDelta throws deterministic non-json-safe error', () => {
    const invalid = {
      schemaVersion: 'sdiff-0.1',
      base: { revisionHash: 'a' },
      target: { revisionHash: 'b' },
      facts: {
        added: [{ unit: { id: 'f-1', value: BigInt(1) } }],
        removed: [],
        modified: [],
      },
      decisions: { added: [], removed: [], modified: [] },
      constraints: { added: [], removed: [], modified: [] },
      risks: { added: [], removed: [], modified: [] },
      assumptions: { added: [], removed: [], modified: [] },
      meta: { collisions: { soft: [], hard: [] } },
    };

    try {
      parseLLMDelta(invalid);
      throw new Error('expected parseLLMDelta to throw');
    } catch (error) {
      expect((error as any).code).toBe('E_LLM_DELTA_NON_JSON_SAFE');
      expect((error as Error).message).toBe('LLM delta contains non JSON-safe value');
    }
  });

  it('parseLLMDelta throws deterministic unsupported-op error', () => {
    const invalid = {
      schemaVersion: 'sdiff-0.1',
      base: { revisionHash: 'a' },
      target: { revisionHash: 'b' },
      facts: { added: [], removed: [], modified: [] },
      decisions: {
        added: [],
        removed: [],
        modified: [
          {
            before: { question: 'Ship now?', answer: 'yes' },
            after: { question: 'Ship now?', answer: 'no' },
            changes: [{ path: 'answer', op: 'move', value: 'no' }],
          },
        ],
      },
      constraints: { added: [], removed: [], modified: [] },
      risks: { added: [], removed: [], modified: [] },
      assumptions: { added: [], removed: [], modified: [] },
      meta: { collisions: { soft: [], hard: [] } },
    };

    try {
      parseLLMDelta(invalid);
      throw new Error('expected parseLLMDelta to throw');
    } catch (error) {
      expect((error as any).code).toBe('E_LLM_DELTA_UNSUPPORTED');
      expect((error as Error).message).toBe('LLM delta contains unsupported operations');
    }
  });

  it('delta mode is deterministic for identical llm delta input', async () => {
    const basePayload = createPayload({
      decisions: [{ question: 'Ship now?', answer: 'yes' }],
    });
    const nextPayload = createPayload({
      decisions: [{ question: 'Ship now?', answer: 'no' }],
    });

    const baseState = revisionToSemanticState(makeRevisionLike(basePayload));
    const nextState = revisionToSemanticState(makeRevisionLike(nextPayload));
    const llmDelta = diffState(baseState, nextState);
    const llmDeltaJson = JSON.stringify(llmDelta);

    const { service } = setupService(basePayload, llmDeltaJson);

    const first = await service.applyPackage(
      'user-1',
      'pkg-1',
      {
        userQuestion: 'Apply same delta',
      },
      { llmMode: 'delta' }
    );
    const second = await service.applyPackage(
      'user-1',
      'pkg-1',
      {
        userQuestion: 'Apply same delta',
      },
      { llmMode: 'delta' }
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.data.applyReport.llmDelta.stateHashAfter).toBe(second.data.applyReport.llmDelta.stateHashAfter);
    expect(first.data.applyReport.llmDelta.deltaSummary).toEqual(second.data.applyReport.llmDelta.deltaSummary);
  });
});
