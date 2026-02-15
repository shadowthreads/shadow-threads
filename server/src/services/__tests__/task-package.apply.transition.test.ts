import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SemanticDelta } from '../../algebra/semanticDiff/types';
import { computeUnitKey } from '../../algebra/semanticDiff/key';
import * as revisionDeltaModule from '../task-package-revision-delta';
import { TaskPackageService } from '../task-package.service';

function createPayload(overrides?: Record<string, unknown>): Record<string, unknown> {
  const base = {
    manifest: {
      schemaVersion: 'tpkg-0.2',
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      title: 'Apply Test',
      capabilities: {
        applyModes: ['bootstrap', 'constrain', 'review'],
        conflictHandling: 'report_only',
      },
    },
    intent: {
      primary: 'Keep behavior deterministic',
      successCriteria: [],
      nonGoals: [],
    },
    state: {
      facts: ['fact-a'],
      decisions: ['decision-a'],
      assumptions: ['assumption-a'],
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
      revision: 1,
    },
    compat: {
      accepts: ['tpkg-0.1'],
      downgradeStrategy: 'lossy-allowed',
    },
    facts: [{ key: 'fact-a', value: 'keep' }],
    decisions: [{ question: 'Should we proceed?', answer: 'yes' }],
    constraintsList: [{ name: 'c1', rule: 'must-keep' }],
    risksList: [],
    assumptions: [{ statement: 'safe' }],
  } as Record<string, unknown>;

  const merged = {
    ...base,
    ...overrides,
  };

  // stateTransition reads top-level "constraints"/"risks"; keep normalized fields above untouched.
  if (!Array.isArray(merged.constraints)) {
    merged.constraints = merged.constraintsList;
  }
  if (!Array.isArray(merged.risks)) {
    merged.risks = merged.risksList;
  }
  delete merged.constraintsList;
  delete merged.risksList;

  return merged;
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

function setupService(payload: Record<string, unknown>) {
  const service = new TaskPackageService();
  vi.spyOn(service as any, 'getOwned').mockResolvedValue(createOwnedPackage(payload));
  const llmSpy = vi.spyOn((service as any).llmService, 'complete').mockResolvedValue({
    content: 'mocked-llm-reply',
  });
  const apiKeySpy = vi.spyOn((service as any).userService, 'getDecryptedApiKey').mockResolvedValue('dummy-key');

  return { service, llmSpy, apiKeySpy };
}

function emptyDomainDelta() {
  return { added: [], removed: [], modified: [] };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TaskPackageService.applyPackage transition integration', () => {
  it('returns deterministic transition report when llmMode=skip without LLM side effects', async () => {
    const basePayload = createPayload();
    const targetPayload = createPayload({
      decisions: [{ question: 'Should we proceed?', answer: 'no' }],
    });
    const { service, llmSpy, apiKeySpy } = setupService(basePayload);

    const result = await service.applyPackage(
      'user-1',
      'pkg-1',
      {
        userQuestion: 'What should we do next?',
        mode: 'review',
        payload: targetPayload,
      },
      { llmMode: 'skip' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.applyReport.transition).toBeDefined();
    expect(result.data.applyReport.contract.conflictHandling).toBe('report_only');
    expect(llmSpy).not.toHaveBeenCalled();
    expect(apiKeySpy).not.toHaveBeenCalled();
  });

  it('captures decision.answer change in deltaSummary and state hashes', async () => {
    const basePayload = createPayload({
      decisions: [{ question: 'Should we proceed?', answer: 'yes' }],
    });
    const targetPayload = createPayload({
      decisions: [{ question: 'Should we proceed?', answer: 'no' }],
    });
    const { service } = setupService(basePayload);

    const result = await service.applyPackage(
      'user-1',
      'pkg-1',
      {
        userQuestion: 'Update the decision',
        mode: 'constrain',
        payload: targetPayload,
      },
      { llmMode: 'skip' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const transition = result.data.applyReport.transition!;
    expect(transition.deltaSummary.modifiedDomains).toContain('decisions');
    expect(transition.stateHashBefore).not.toBe(transition.stateHashAfter);
  });

  it('reports transition conflicts and rejected counts for invalid delta entries', async () => {
    const basePayload = createPayload({
      facts: [{ key: 'fact-a', value: 'keep' }],
    });
    const targetPayload = createPayload();
    const { service } = setupService(basePayload);
    const existingFactKey = computeUnitKey('facts', (basePayload.facts as unknown[])[0]);

    const fakeDelta: SemanticDelta = {
      schemaVersion: 'sdiff-0.1',
      base: { revisionHash: 'base' },
      target: { revisionHash: 'target' },
      facts: {
        added: [{ key: existingFactKey, unit: { key: 'fact-a', value: 'dupe' } }],
        removed: [{ key: 'missing-fact-key', unit: { key: 'missing', value: 'x' } }],
        modified: [],
      },
      decisions: emptyDomainDelta(),
      constraints: emptyDomainDelta(),
      risks: emptyDomainDelta(),
      assumptions: emptyDomainDelta(),
      meta: {
        determinism: {
          canonicalVersion: 'tpkg-0.2-canon-v1',
          keyStrategy: 'sig-hash-v1',
          tieBreakers: ['secondary-unit-hash-v1'],
        },
        collisions: { hard: [], soft: [] },
        counts: {},
      },
    };

    const deltaSpy = vi.spyOn(revisionDeltaModule, 'computeRevisionDelta').mockReturnValue(fakeDelta);

    try {
      const result = await service.applyPackage(
        'user-1',
        'pkg-1',
        {
          userQuestion: 'Force conflict reporting',
          mode: 'bootstrap',
          payload: targetPayload,
        },
        { llmMode: 'skip' }
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const transition = result.data.applyReport.transition!;
      const conflictCodes = transition.conflicts.map((item: { code: string }) => item.code);
      expect(conflictCodes).toContain('E_ADD_EXISTS');
      expect(conflictCodes).toContain('E_REMOVE_MISSING');
      expect(transition.rejectedCounts.facts.added).toBeGreaterThanOrEqual(1);
      expect(transition.rejectedCounts.facts.removed).toBeGreaterThanOrEqual(1);
    } finally {
      deltaSpy.mockRestore();
    }
  });

  it('emits POST_APPLY_CONFLICTS finding from deterministic post-checks', async () => {
    const basePayload = createPayload({
      constraints: [{ name: 'c1', rule: 'must-keep' }],
    });
    const targetPayload = createPayload({
      constraints: [{ name: 'c1', rule: '' }],
    });
    const { service } = setupService(basePayload);

    const result = await service.applyPackage(
      'user-1',
      'pkg-1',
      {
        userQuestion: 'Apply constraint update',
        mode: 'review',
        payload: targetPayload,
      },
      { llmMode: 'skip' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const transition = result.data.applyReport.transition!;
    expect(transition.postApplyConflicts.some((item: { code: string }) => item.code === 'E_CONSTRAINT_RULE_EMPTY')).toBe(true);

    const postApplyFinding = transition.findings.find((item: { code: string }) => item.code === 'POST_APPLY_CONFLICTS');
    expect(postApplyFinding).toBeDefined();
    expect(postApplyFinding?.domains).toEqual(['constraints']);
    expect(postApplyFinding?.count).toBeGreaterThan(0);
  });
});
