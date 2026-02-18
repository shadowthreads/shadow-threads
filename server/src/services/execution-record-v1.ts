import { stableHash } from '../algebra/semanticDiff/key';
import type { SemanticDelta, FieldChange } from '../algebra/semanticDiff/types';
import type { TransitionMode } from '../algebra/stateTransition/types';
import type { ApplyReportV1 } from './apply-report-v1';

const DOMAIN_ORDER = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'] as const;
type OrderedDomain = (typeof DOMAIN_ORDER)[number];
type Mode = 'legacy' | 'transition' | 'revision_net_delta' | 'llm_delta';

type DomainCounts = Record<OrderedDomain, { added: number; removed: number; modified: number }>;

export type ExecutionRecordV1 = {
  schema: 'execution-record-1';
  ids: {
    taskPackageId: string;
    packageRevisionId: string | null;
    baseRevisionId: string | null;
    targetRevisionId: string | null;
  };
  mode: Mode;
  inputs: {
    execution: {
      llmMode: 'legacy' | 'skip' | 'delta';
      transitionMode: 'best_effort' | 'strict' | null;
      llmDeltaMode: 'best_effort' | 'strict' | null;
      revisionNetDelta: { fromRevisionId: string; toRevisionId: string } | null;
      usedInjectedDelta: boolean;
    };
    delta: SemanticDelta | null;
    deltaSummary: {
      modifiedDomains: OrderedDomain[];
      counts: DomainCounts;
      hasCollisions: boolean;
      assumptionsDerived: boolean;
    } | null;
  };
  outputs: {
    applyReportV1: ApplyReportV1;
  };
  identity: {
    stateHashBefore: string | null;
    stateHashAfter: string | null;
    deltaHash: string | null;
    reportHash: string;
  };
  determinism: {
    sorted: true;
    domainOrder: ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];
  };
};

export type BuildExecutionRecordV1Input = {
  taskPackageId: string;
  packageRevisionId?: string | null;
  baseRevisionId?: string | null;
  targetRevisionId?: string | null;
  llmMode?: 'legacy' | 'skip' | 'delta';
  transitionMode?: TransitionMode | null;
  llmDeltaMode?: TransitionMode | null;
  revisionNetDelta?: { fromRevisionId: string; toRevisionId: string } | null;
  usedInjectedDelta?: boolean;
  applyReportV1: ApplyReportV1;
  delta?: SemanticDelta | null;
  deltaSummary?: ApplyReportV1['delta']['summary'] | null;
  stateHashBefore?: string | null;
  stateHashAfter?: string | null;
};

type ExecutionRecordErrorCode = 'E_EXECUTION_RECORD_INVALID' | 'E_EXECUTION_RECORD_NON_JSON_SAFE';
type ExecutionRecordError = Error & { code: ExecutionRecordErrorCode };

function makeExecutionRecordError(code: ExecutionRecordErrorCode, message: string): ExecutionRecordError {
  const error = new Error(message) as ExecutionRecordError;
  error.code = code;
  return error;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function domainRank(domain: string): number {
  const index = DOMAIN_ORDER.indexOf(domain as OrderedDomain);
  return index === -1 ? DOMAIN_ORDER.length : index;
}

function safeStableHash(value: unknown): string {
  try {
    return stableHash(value);
  } catch {
    throw makeExecutionRecordError('E_EXECUTION_RECORD_NON_JSON_SAFE', 'Execution record contains non JSON-safe value');
  }
}

function normalizeDomainOrder(domains: readonly string[] | undefined): OrderedDomain[] {
  if (!domains) return [];
  const set = new Set(domains.filter((domain): domain is OrderedDomain => DOMAIN_ORDER.includes(domain as OrderedDomain)));
  return DOMAIN_ORDER.filter((domain) => set.has(domain));
}

function normalizeCounts(input: unknown): DomainCounts {
  const value = (input ?? {}) as Record<string, unknown>;
  const parse = (domain: OrderedDomain) => {
    const item = (value[domain] ?? {}) as Record<string, unknown>;
    const asNumber = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
      added: asNumber(item.added),
      removed: asNumber(item.removed),
      modified: asNumber(item.modified),
    };
  };

  return {
    facts: parse('facts'),
    decisions: parse('decisions'),
    constraints: parse('constraints'),
    risks: parse('risks'),
    assumptions: parse('assumptions'),
  };
}

function normalizeConflictEntry(
  entry: { domain: string; code: string; key?: string; path?: string; message: string }
): { domain: string; code: string; key?: string; path?: string; message: string } {
  const normalized = {
    domain: typeof entry.domain === 'string' ? entry.domain : '',
    code: typeof entry.code === 'string' ? entry.code : '',
    message: typeof entry.message === 'string' ? entry.message : '',
  } as { domain: string; code: string; key?: string; path?: string; message: string };

  if (typeof entry.key === 'string') normalized.key = entry.key;
  if (typeof entry.path === 'string') normalized.path = entry.path;
  return normalized;
}

function sortConflictEntries(
  entries: Array<{ domain: string; code: string; key?: string; path?: string; message: string }>
): Array<{ domain: string; code: string; key?: string; path?: string; message: string }> {
  const list = entries.map(normalizeConflictEntry);
  list.sort((a, b) => {
    return (
      domainRank(a.domain) - domainRank(b.domain) ||
      compareStrings(a.code, b.code) ||
      compareStrings(a.key ?? '', b.key ?? '') ||
      compareStrings(a.path ?? '', b.path ?? '') ||
      compareStrings(a.message, b.message)
    );
  });
  return list;
}

function sortFindings(
  findings: ApplyReportV1['findings']
): ApplyReportV1['findings'] {
  const list = findings.map((finding) => {
    const normalized: ApplyReportV1['findings'][number] = { code: typeof finding.code === 'string' ? finding.code : '' };
    if (typeof finding.message === 'string') normalized.message = finding.message;
    if (typeof finding.count === 'number' && Number.isFinite(finding.count)) normalized.count = finding.count;
    const orderedDomains = normalizeDomainOrder(finding.domains?.map((domain) => String(domain)));
    if (orderedDomains.length > 0) normalized.domains = orderedDomains;
    return normalized;
  });

  list.sort((a, b) => {
    return (
      compareStrings(a.code, b.code) ||
      compareStrings(a.message ?? '', b.message ?? '') ||
      (a.count ?? 0) - (b.count ?? 0) ||
      compareStrings((a.domains ?? []).join(','), (b.domains ?? []).join(','))
    );
  });
  return list;
}

function normalizeSummary(
  summary: ApplyReportV1['delta']['summary'] | null | undefined
): ApplyReportV1['delta']['summary'] {
  if (!summary) return null;
  return {
    modifiedDomains: normalizeDomainOrder(summary.modifiedDomains),
    counts: normalizeCounts(summary.counts),
    hasCollisions: summary.hasCollisions === true,
    assumptionsDerived: summary.assumptionsDerived === true,
  };
}

function normalizeChange(change: FieldChange): FieldChange {
  const normalized: FieldChange = {
    path: typeof change.path === 'string' ? change.path : '',
    op: change.op,
  };
  if ('before' in change) normalized.before = change.before;
  if ('after' in change) normalized.after = change.after;
  if ('value' in change) normalized.value = change.value;
  return normalized;
}

function changeOpRank(op: FieldChange['op']): number {
  if (op === 'set') return 0;
  if (op === 'unset') return 1;
  if (op === 'append') return 2;
  return 3;
}

function sortChanges(changes: FieldChange[]): FieldChange[] {
  const list = changes.map(normalizeChange);
  list.sort((a, b) => {
    const opDiff = changeOpRank(a.op) - changeOpRank(b.op);
    const aValueHash = 'value' in a ? safeStableHash(a.value) : '';
    const bValueHash = 'value' in b ? safeStableHash(b.value) : '';
    return (
      compareStrings(a.path, b.path) ||
      opDiff ||
      compareStrings(aValueHash, bValueHash) ||
      compareStrings(safeStableHash('before' in a ? a.before : null), safeStableHash('before' in b ? b.before : null)) ||
      compareStrings(safeStableHash('after' in a ? a.after : null), safeStableHash('after' in b ? b.after : null))
    );
  });
  return list;
}

function normalizeDelta(delta: SemanticDelta | null | undefined): SemanticDelta | null {
  if (!delta) return null;

  const normalizeDomain = (domain: OrderedDomain) => {
    const source = delta[domain];
    return {
      added: [...source.added]
        .map((item) => ({ key: item.key, unit: item.unit }))
        .sort(
          (a, b) =>
            compareStrings(a.key, b.key) ||
            compareStrings(safeStableHash(a.unit), safeStableHash(b.unit))
        ),
      removed: [...source.removed]
        .map((item) => ({ key: item.key, unit: item.unit }))
        .sort(
          (a, b) =>
            compareStrings(a.key, b.key) ||
            compareStrings(safeStableHash(a.unit), safeStableHash(b.unit))
        ),
      modified: [...source.modified]
        .map((item) => ({
          key: item.key,
          before: item.before,
          after: item.after,
          changes: sortChanges(item.changes),
        }))
        .sort((a, b) => compareStrings(a.key, b.key)),
    };
  };

  return {
    schemaVersion: 'sdiff-0.1',
    base: { revisionHash: delta.base?.revisionHash ?? '' },
    target: { revisionHash: delta.target?.revisionHash ?? '' },
    facts: normalizeDomain('facts'),
    decisions: normalizeDomain('decisions'),
    constraints: normalizeDomain('constraints'),
    risks: normalizeDomain('risks'),
    assumptions: normalizeDomain('assumptions'),
    meta: {
      determinism: {
        canonicalVersion: delta.meta?.determinism?.canonicalVersion ?? 'tpkg-0.2-canon-v1',
        keyStrategy: delta.meta?.determinism?.keyStrategy ?? 'sig-hash-v1',
        tieBreakers: [...(delta.meta?.determinism?.tieBreakers ?? [])].sort(compareStrings),
      },
      collisions: {
        soft: [...(delta.meta?.collisions?.soft ?? [])].sort(compareStrings),
        hard: [...(delta.meta?.collisions?.hard ?? [])].sort(compareStrings),
      },
      assumptionsDerived: delta.meta?.assumptionsDerived === true,
      counts: Object.fromEntries(
        Object.entries(delta.meta?.counts ?? {}).sort((a, b) => compareStrings(String(a[0]), String(b[0])))
      ),
    },
  };
}

function normalizeApplyReportV1(report: ApplyReportV1): ApplyReportV1 {
  return {
    schema: 'apply-report-1',
    mode: report.mode,
    execution: {
      llmMode: report.execution?.llmMode ?? 'legacy',
      transitionMode: report.execution?.transitionMode ?? null,
      revisionNetDelta: report.execution?.revisionNetDelta
        ? {
            fromRevisionId: report.execution.revisionNetDelta.fromRevisionId,
            toRevisionId: report.execution.revisionNetDelta.toRevisionId,
          }
        : null,
      usedInjectedDelta: report.execution?.usedInjectedDelta === true,
    },
    identity: {
      stateHashBefore: report.identity?.stateHashBefore ?? null,
      stateHashAfter: report.identity?.stateHashAfter ?? null,
      baseRevisionId: report.identity?.baseRevisionId ?? null,
      targetRevisionId: report.identity?.targetRevisionId ?? null,
    },
    delta: {
      summary: normalizeSummary(report.delta?.summary),
    },
    transition: {
      appliedCounts: normalizeCounts(report.transition?.appliedCounts),
      rejectedCounts: normalizeCounts(report.transition?.rejectedCounts),
    },
    conflictSurface: {
      conflicts: sortConflictEntries(report.conflictSurface?.conflicts ?? []),
      postApplyConflicts: sortConflictEntries(report.conflictSurface?.postApplyConflicts ?? []),
    },
    findings: sortFindings(report.findings ?? []),
    determinism: {
      sorted: true,
      domainOrder: ['facts', 'decisions', 'constraints', 'risks', 'assumptions'],
    },
  };
}

function resolveMode(input: BuildExecutionRecordV1Input, reportV1: ApplyReportV1): Mode {
  if (input.revisionNetDelta) return 'revision_net_delta';
  if (input.llmMode === 'delta') return 'llm_delta';
  if (reportV1.mode === 'transition') return 'transition';
  return 'legacy';
}

export function buildExecutionRecordV1(input: BuildExecutionRecordV1Input): ExecutionRecordV1 {
  if (!input || typeof input !== 'object' || typeof input.taskPackageId !== 'string' || !input.applyReportV1) {
    throw makeExecutionRecordError('E_EXECUTION_RECORD_INVALID', 'Execution record input is invalid');
  }

  const reportV1 = normalizeApplyReportV1(input.applyReportV1);
  const mode = resolveMode(input, reportV1);
  const delta = normalizeDelta(input.delta ?? null);
  const deltaSummary = normalizeSummary(input.deltaSummary ?? reportV1.delta.summary ?? null);

  const record: ExecutionRecordV1 = {
    schema: 'execution-record-1',
    ids: {
      taskPackageId: input.taskPackageId,
      packageRevisionId: input.packageRevisionId ?? null,
      baseRevisionId: input.baseRevisionId ?? null,
      targetRevisionId: input.targetRevisionId ?? null,
    },
    mode,
    inputs: {
      execution: {
        llmMode: input.llmMode ?? 'legacy',
        transitionMode: input.transitionMode ?? null,
        llmDeltaMode: input.llmDeltaMode ?? null,
        revisionNetDelta: input.revisionNetDelta ?? null,
        usedInjectedDelta: input.usedInjectedDelta === true,
      },
      delta,
      deltaSummary,
    },
    outputs: {
      applyReportV1: reportV1,
    },
    identity: {
      stateHashBefore: input.stateHashBefore ?? reportV1.identity.stateHashBefore ?? null,
      stateHashAfter: input.stateHashAfter ?? reportV1.identity.stateHashAfter ?? null,
      deltaHash: delta ? safeStableHash(delta) : null,
      reportHash: safeStableHash(reportV1),
    },
    determinism: {
      sorted: true,
      domainOrder: ['facts', 'decisions', 'constraints', 'risks', 'assumptions'],
    },
  };

  safeStableHash(record);
  return record;
}
