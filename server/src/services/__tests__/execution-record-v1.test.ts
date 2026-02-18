import { describe, expect, it } from 'vitest';

import { stableHash } from '../../algebra/semanticDiff/key';
import type { SemanticDelta } from '../../algebra/semanticDiff/types';
import type { ApplyReportV1 } from '../apply-report-v1';
import { buildExecutionRecordV1 } from '../execution-record-v1';

const DOMAIN_ORDER = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'] as const;

function makeEmptyDelta(): SemanticDelta {
  return {
    schemaVersion: 'sdiff-0.1',
    base: { revisionHash: 'base-hash' },
    target: { revisionHash: 'target-hash' },
    facts: { added: [], removed: [], modified: [] },
    decisions: { added: [], removed: [], modified: [] },
    constraints: { added: [], removed: [], modified: [] },
    risks: { added: [], removed: [], modified: [] },
    assumptions: { added: [], removed: [], modified: [] },
    meta: {
      determinism: {
        canonicalVersion: 'tpkg-0.2-canon-v1',
        keyStrategy: 'sig-hash-v1',
        tieBreakers: ['test'],
      },
      collisions: { soft: [], hard: [] },
      counts: {},
      assumptionsDerived: false,
    },
  };
}

function makeApplyReportV1(overrides?: Partial<ApplyReportV1>): ApplyReportV1 {
  const base: ApplyReportV1 = {
    schema: 'apply-report-1',
    mode: 'legacy',
    execution: {
      llmMode: 'legacy',
      transitionMode: null,
      revisionNetDelta: null,
      usedInjectedDelta: false,
    },
    identity: {
      stateHashBefore: null,
      stateHashAfter: null,
      baseRevisionId: null,
      targetRevisionId: null,
    },
    delta: {
      summary: {
        modifiedDomains: [],
        counts: {
          facts: { added: 0, removed: 0, modified: 0 },
          decisions: { added: 0, removed: 0, modified: 0 },
          constraints: { added: 0, removed: 0, modified: 0 },
          risks: { added: 0, removed: 0, modified: 0 },
          assumptions: { added: 0, removed: 0, modified: 0 },
        },
        hasCollisions: false,
        assumptionsDerived: false,
      },
    },
    transition: {
      appliedCounts: {
        facts: { added: 0, removed: 0, modified: 0 },
        decisions: { added: 0, removed: 0, modified: 0 },
        constraints: { added: 0, removed: 0, modified: 0 },
        risks: { added: 0, removed: 0, modified: 0 },
        assumptions: { added: 0, removed: 0, modified: 0 },
      },
      rejectedCounts: {
        facts: { added: 0, removed: 0, modified: 0 },
        decisions: { added: 0, removed: 0, modified: 0 },
        constraints: { added: 0, removed: 0, modified: 0 },
        risks: { added: 0, removed: 0, modified: 0 },
        assumptions: { added: 0, removed: 0, modified: 0 },
      },
    },
    conflictSurface: {
      conflicts: [],
      postApplyConflicts: [],
    },
    findings: [],
    determinism: {
      sorted: true,
      domainOrder: [...DOMAIN_ORDER],
    },
  };

  return { ...base, ...overrides };
}

describe('buildExecutionRecordV1', () => {
  it('builds minimal legacy record with stable hashes', () => {
    const reportV1 = makeApplyReportV1();
    const first = buildExecutionRecordV1({
      taskPackageId: 'pkg-1',
      packageRevisionId: 'rev-1',
      applyReportV1: reportV1,
    });
    const second = buildExecutionRecordV1({
      taskPackageId: 'pkg-1',
      packageRevisionId: 'rev-1',
      applyReportV1: reportV1,
    });

    expect(first.schema).toBe('execution-record-1');
    expect(first.mode).toBe('legacy');
    expect(first.identity.deltaHash).toBeNull();
    expect(first.identity.reportHash).toBe(stableHash(first.outputs.applyReportV1));
    expect(stableHash(first)).toBe(stableHash(second));
  });

  it('normalizes llm_delta record and computes deltaHash/reportHash', () => {
    const delta = makeEmptyDelta();
    delta.decisions.modified.push({
      key: 'k-2',
      before: { question: 'q', answer: 'a' },
      after: { question: 'q', answer: 'b' },
      changes: [
        { path: 'answer', op: 'set', after: 'b' },
      ],
    });

    const reportV1 = makeApplyReportV1({
      mode: 'llm_delta',
      execution: {
        llmMode: 'delta',
        transitionMode: 'best_effort',
        revisionNetDelta: null,
        usedInjectedDelta: true,
      },
      conflictSurface: {
        conflicts: [
          { domain: 'risks', code: 'B', message: 'r' },
          { domain: 'facts', code: 'A', message: 'f' },
        ],
        postApplyConflicts: [],
      },
    });

    const record = buildExecutionRecordV1({
      taskPackageId: 'pkg-1',
      llmMode: 'delta',
      llmDeltaMode: 'best_effort',
      usedInjectedDelta: true,
      applyReportV1: reportV1,
      delta,
    });

    expect(record.mode).toBe('llm_delta');
    expect(record.identity.deltaHash).toBe(stableHash(record.inputs.delta));
    expect(record.identity.reportHash).toBe(stableHash(record.outputs.applyReportV1));
    expect(record.outputs.applyReportV1.conflictSurface.conflicts.map((c) => c.domain)).toEqual(['facts', 'risks']);
  });

  it('is stable across permuted arrays', () => {
    const deltaA = makeEmptyDelta();
    deltaA.facts.added.push({ key: 'b', unit: { id: 'b' } });
    deltaA.facts.added.push({ key: 'a', unit: { id: 'a' } });

    const deltaB = makeEmptyDelta();
    deltaB.facts.added.push({ key: 'a', unit: { id: 'a' } });
    deltaB.facts.added.push({ key: 'b', unit: { id: 'b' } });

    const reportA = makeApplyReportV1({
      conflictSurface: {
        conflicts: [
          { domain: 'decisions', code: 'B', message: '2' },
          { domain: 'facts', code: 'A', message: '1' },
        ],
        postApplyConflicts: [],
      },
      findings: [
        { code: 'B', message: 'bb', count: 2, domains: ['decisions'] },
        { code: 'A', message: 'aa', count: 1, domains: ['facts'] },
      ],
    });

    const reportB = makeApplyReportV1({
      conflictSurface: {
        conflicts: [...reportA.conflictSurface.conflicts].reverse(),
        postApplyConflicts: [],
      },
      findings: [...reportA.findings].reverse(),
    });

    const recordA = buildExecutionRecordV1({
      taskPackageId: 'pkg-1',
      applyReportV1: reportA,
      delta: deltaA,
    });
    const recordB = buildExecutionRecordV1({
      taskPackageId: 'pkg-1',
      applyReportV1: reportB,
      delta: deltaB,
    });

    expect(stableHash(recordA)).toBe(stableHash(recordB));
  });

  it('throws deterministic non-json-safe error', () => {
    const delta = makeEmptyDelta();
    delta.facts.added.push({ key: 'bad', unit: { value: BigInt(1) } });

    try {
      buildExecutionRecordV1({
        taskPackageId: 'pkg-1',
        applyReportV1: makeApplyReportV1(),
        delta,
      });
      throw new Error('expected throw');
    } catch (error) {
      expect((error as any).code).toBe('E_EXECUTION_RECORD_NON_JSON_SAFE');
      expect((error as Error).message).toBe('Execution record contains non JSON-safe value');
    }
  });
});
