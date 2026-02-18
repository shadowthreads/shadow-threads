import { describe, expect, it } from 'vitest';

import { stableHash } from '../../algebra/semanticDiff/key';
import { buildApplyReportV1 } from '../apply-report-v1';

describe('buildApplyReportV1', () => {
  it('builds legacy minimal report deterministically', () => {
    const report = buildApplyReportV1({ llmMode: 'legacy' });

    expect(report.schema).toBe('apply-report-1');
    expect(report.mode).toBe('legacy');
    expect(report.execution).toEqual({
      llmMode: 'legacy',
      transitionMode: null,
      revisionNetDelta: null,
      usedInjectedDelta: false,
    });
    expect(report.identity).toEqual({
      stateHashBefore: null,
      stateHashAfter: null,
      baseRevisionId: null,
      targetRevisionId: null,
    });
    expect(report.delta.summary).toBeNull();
    expect(report.conflictSurface.conflicts).toEqual([]);
    expect(report.conflictSurface.postApplyConflicts).toEqual([]);
    expect(report.findings).toEqual([]);
    expect(report.determinism.domainOrder).toEqual(['facts', 'decisions', 'constraints', 'risks', 'assumptions']);
  });

  it('sorts transition conflicts and modifiedDomains by fixed domain order', () => {
    const report = buildApplyReportV1({
      llmMode: 'legacy',
      transitionMode: 'best_effort',
      transition: {
        deltaSummary: {
          modifiedDomains: ['risks', 'facts', 'decisions'],
          counts: {
            facts: { added: 1, removed: 0, modified: 0 },
            decisions: { added: 0, removed: 0, modified: 1 },
            constraints: { added: 0, removed: 0, modified: 0 },
            risks: { added: 0, removed: 1, modified: 0 },
            assumptions: { added: 0, removed: 0, modified: 0 },
          },
          hasCollisions: false,
          assumptionsDerived: false,
        },
        conflicts: [
          { domain: 'risks', code: 'B', key: 'z', message: 'r-z' },
          { domain: 'facts', code: 'A', key: 'z', message: 'f-z' },
          { domain: 'facts', code: 'A', message: 'f-empty' },
          { domain: 'facts', code: 'A', key: 'a', message: 'f-a' },
        ],
        postApplyConflicts: [
          { domain: 'assumptions', code: 'A', message: 'a-1' },
          { domain: 'decisions', code: 'A', key: 'k1', message: 'd-1' },
        ],
        findings: [
          { code: 'B', message: 'm2', count: 3, domains: ['risks', 'facts'] },
          { code: 'A', message: 'm1', count: 1, domains: ['decisions'] },
        ],
      },
    });

    expect(report.mode).toBe('transition');
    expect(report.delta.summary?.modifiedDomains).toEqual(['facts', 'decisions', 'risks']);
    expect(report.conflictSurface.conflicts.map((item) => `${item.domain}:${item.code}:${item.key ?? ''}:${item.message}`)).toEqual([
      'facts:A::f-empty',
      'facts:A:a:f-a',
      'facts:A:z:f-z',
      'risks:B:z:r-z',
    ]);
    expect(report.findings.map((item) => `${item.code}:${item.message ?? ''}:${item.count ?? 0}`)).toEqual([
      'A:m1:1',
      'B:m2:3',
    ]);
  });

  it('marks llm delta mode with injected delta flag', () => {
    const report = buildApplyReportV1({
      llmMode: 'delta',
      transitionMode: 'best_effort',
      usedInjectedDelta: true,
      llmDelta: {
        deltaSummary: {
          modifiedDomains: ['decisions'],
          counts: {
            facts: { added: 0, removed: 0, modified: 0 },
            decisions: { added: 0, removed: 0, modified: 1 },
            constraints: { added: 0, removed: 0, modified: 0 },
            risks: { added: 0, removed: 0, modified: 0 },
            assumptions: { added: 0, removed: 0, modified: 0 },
          },
          hasCollisions: false,
          assumptionsDerived: false,
        },
        conflicts: [{ domain: 'decisions', code: 'E', key: 'k1', message: 'c1' }],
        postApplyConflicts: [],
        stateHashBefore: 'before',
        stateHashAfter: 'after',
      },
    });

    expect(report.mode).toBe('llm_delta');
    expect(report.execution.llmMode).toBe('delta');
    expect(report.execution.usedInjectedDelta).toBe(true);
    expect(report.identity.stateHashBefore).toBe('before');
    expect(report.identity.stateHashAfter).toBe('after');
  });

  it('selects revision_net_delta mode and echoes revision ids', () => {
    const report = buildApplyReportV1({
      llmMode: 'legacy',
      revisionNetDelta: { fromRevisionId: 'rev-1', toRevisionId: 'rev-2' },
      revisionNetDeltaReport: {
        stateHashBefore: 'hash-1',
        stateHashAfter: 'hash-2',
      },
    });

    expect(report.mode).toBe('revision_net_delta');
    expect(report.execution.revisionNetDelta).toEqual({ fromRevisionId: 'rev-1', toRevisionId: 'rev-2' });
    expect(report.identity.baseRevisionId).toBe('rev-1');
    expect(report.identity.targetRevisionId).toBe('rev-2');
  });

  it('produces stable output for permuted conflict input', () => {
    const baseInput = {
      llmMode: 'legacy' as const,
      transitionMode: 'best_effort' as const,
      transition: {
        deltaSummary: {
          modifiedDomains: ['constraints', 'facts'],
          counts: {
            facts: { added: 1, removed: 0, modified: 0 },
            decisions: { added: 0, removed: 0, modified: 0 },
            constraints: { added: 0, removed: 1, modified: 0 },
            risks: { added: 0, removed: 0, modified: 0 },
            assumptions: { added: 0, removed: 0, modified: 0 },
          },
          hasCollisions: true,
          assumptionsDerived: true,
        },
        conflicts: [
          { domain: 'constraints', code: 'B', key: '2', path: 'p2', message: 'm2' },
          { domain: 'facts', code: 'A', key: '1', path: 'p1', message: 'm1' },
        ],
        postApplyConflicts: [
          { domain: 'risks', code: 'C', key: '3', path: 'p3', message: 'm3' },
        ],
        findings: [
          { code: 'B', message: 'bbb', count: 2, domains: ['constraints', 'facts'] },
          { code: 'A', message: 'aaa', count: 1, domains: ['assumptions'] },
        ],
      },
    };

    const first = buildApplyReportV1(baseInput);
    const second = buildApplyReportV1({
      ...baseInput,
      transition: {
        ...baseInput.transition,
        conflicts: [...baseInput.transition.conflicts].reverse(),
        findings: [...baseInput.transition.findings].reverse(),
      },
    });

    expect(stableHash(first)).toBe(stableHash(second));
  });
});
