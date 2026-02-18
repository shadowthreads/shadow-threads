import type { DomainName } from '../algebra/semanticDiff/types';
import type { TransitionConflict, TransitionMode, TransitionPerDomainCounts } from '../algebra/stateTransition/types';

const DOMAIN_ORDER = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'] as const;
type OrderedDomain = (typeof DOMAIN_ORDER)[number];
type DomainCount = { added: number; removed: number; modified: number };

type DeltaSummaryLike = {
  modifiedDomains: OrderedDomain[];
  counts: Record<OrderedDomain, DomainCount>;
  hasCollisions: boolean;
  assumptionsDerived: boolean;
};

type TransitionFindingLike = {
  code: string;
  message?: string;
  count?: number;
  domains?: DomainName[];
};

type TransitionFragment = {
  deltaSummary?: DeltaSummaryLike | null;
  appliedCounts?: TransitionPerDomainCounts | null;
  rejectedCounts?: TransitionPerDomainCounts | null;
  conflicts?: TransitionConflict[] | null;
  postApplyConflicts?: TransitionConflict[] | null;
  findings?: TransitionFindingLike[] | null;
  stateHashBefore?: string | null;
  stateHashAfter?: string | null;
};

type LlmDeltaFragment = {
  deltaSummary?: DeltaSummaryLike | null;
  conflicts?: TransitionConflict[] | null;
  postApplyConflicts?: TransitionConflict[] | null;
  stateHashBefore?: string | null;
  stateHashAfter?: string | null;
};

type RevisionNetDeltaFragment = {
  deltaSummary?: DeltaSummaryLike | null;
  stateHashBefore?: string | null;
  stateHashAfter?: string | null;
};

export type ApplyReportV1 = {
  schema: 'apply-report-1';
  mode: 'legacy' | 'transition' | 'revision_net_delta' | 'llm_delta';
  execution: {
    llmMode: 'legacy' | 'skip' | 'delta';
    transitionMode?: 'best_effort' | 'strict' | null;
    revisionNetDelta?: { fromRevisionId: string; toRevisionId: string } | null;
    usedInjectedDelta?: boolean;
  };
  identity: {
    stateHashBefore?: string | null;
    stateHashAfter?: string | null;
    baseRevisionId?: string | null;
    targetRevisionId?: string | null;
  };
  delta: {
    summary?: {
      modifiedDomains: OrderedDomain[];
      counts: Record<OrderedDomain, DomainCount>;
      hasCollisions: boolean;
      assumptionsDerived: boolean;
    } | null;
  };
  transition: {
    appliedCounts?: Record<OrderedDomain, DomainCount> | null;
    rejectedCounts?: Record<OrderedDomain, DomainCount> | null;
  };
  conflictSurface: {
    conflicts: Array<{ domain: string; code: string; key?: string; path?: string; message: string }>;
    postApplyConflicts: Array<{ domain: string; code: string; key?: string; path?: string; message: string }>;
  };
  findings: Array<{
    code: string;
    message?: string;
    count?: number;
    domains?: OrderedDomain[];
  }>;
  determinism: {
    sorted: true;
    domainOrder: ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];
  };
};

export type BuildApplyReportV1Input = {
  llmMode?: 'legacy' | 'skip' | 'delta';
  transitionMode?: TransitionMode | null;
  revisionNetDelta?: { fromRevisionId: string; toRevisionId: string } | null;
  usedInjectedDelta?: boolean;
  baseRevisionId?: string | null;
  targetRevisionId?: string | null;
  transition?: TransitionFragment | null;
  llmDelta?: LlmDeltaFragment | null;
  revisionNetDeltaReport?: RevisionNetDeltaFragment | null;
};

function toDomainOrder(domains: readonly string[] | undefined): OrderedDomain[] {
  if (!domains) return [];
  const set = new Set(domains.filter((domain): domain is OrderedDomain => DOMAIN_ORDER.includes(domain as OrderedDomain)));
  return DOMAIN_ORDER.filter((domain) => set.has(domain));
}

function domainRank(domain: string): number {
  const index = DOMAIN_ORDER.indexOf(domain as OrderedDomain);
  return index === -1 ? DOMAIN_ORDER.length : index;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeDomainCount(input: unknown): DomainCount {
  const value = (input ?? {}) as Record<string, unknown>;
  return {
    added: numberOrZero(value.added),
    removed: numberOrZero(value.removed),
    modified: numberOrZero(value.modified),
  };
}

function normalizePerDomainCounts(input: unknown): Record<OrderedDomain, DomainCount> | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  return {
    facts: normalizeDomainCount(value.facts),
    decisions: normalizeDomainCount(value.decisions),
    constraints: normalizeDomainCount(value.constraints),
    risks: normalizeDomainCount(value.risks),
    assumptions: normalizeDomainCount(value.assumptions),
  };
}

function normalizeSummary(input: DeltaSummaryLike | null | undefined): ApplyReportV1['delta']['summary'] {
  if (!input) return null;

  return {
    modifiedDomains: toDomainOrder(input.modifiedDomains),
    counts: {
      facts: normalizeDomainCount(input.counts?.facts),
      decisions: normalizeDomainCount(input.counts?.decisions),
      constraints: normalizeDomainCount(input.counts?.constraints),
      risks: normalizeDomainCount(input.counts?.risks),
      assumptions: normalizeDomainCount(input.counts?.assumptions),
    },
    hasCollisions: input.hasCollisions === true,
    assumptionsDerived: input.assumptionsDerived === true,
  };
}

function normalizeConflictSurface(
  conflicts: readonly TransitionConflict[] | null | undefined
): ApplyReportV1['conflictSurface']['conflicts'] {
  const list = (conflicts ?? []).map((conflict) => {
    const normalized = {
      domain: typeof conflict.domain === 'string' ? conflict.domain : '',
      code: typeof conflict.code === 'string' ? conflict.code : '',
      message: typeof conflict.message === 'string' ? conflict.message : '',
    } as ApplyReportV1['conflictSurface']['conflicts'][number];

    if (typeof conflict.key === 'string') normalized.key = conflict.key;
    if (typeof conflict.path === 'string') normalized.path = conflict.path;

    return normalized;
  });

  list.sort((a, b) => {
    return (
      domainRank(a.domain) - domainRank(b.domain) ||
      a.code.localeCompare(b.code) ||
      (a.key ?? '').localeCompare(b.key ?? '') ||
      (a.path ?? '').localeCompare(b.path ?? '') ||
      a.message.localeCompare(b.message)
    );
  });

  return list;
}

function normalizeFindings(input: readonly TransitionFindingLike[] | null | undefined): ApplyReportV1['findings'] {
  const list = (input ?? []).map((finding) => {
    const normalized: ApplyReportV1['findings'][number] = {
      code: typeof finding.code === 'string' ? finding.code : '',
    };

    if (typeof finding.message === 'string') normalized.message = finding.message;
    if (typeof finding.count === 'number' && Number.isFinite(finding.count)) normalized.count = finding.count;

    const orderedDomains = toDomainOrder(finding.domains?.map((domain) => String(domain)));
    if (orderedDomains.length > 0) normalized.domains = orderedDomains;

    return normalized;
  });

  list.sort((a, b) => {
    return (
      a.code.localeCompare(b.code) ||
      (a.message ?? '').localeCompare(b.message ?? '') ||
      (a.count ?? 0) - (b.count ?? 0) ||
      (a.domains ?? []).join(',').localeCompare((b.domains ?? []).join(','))
    );
  });

  return list;
}

function resolveMode(input: BuildApplyReportV1Input): ApplyReportV1['mode'] {
  if (input.revisionNetDelta) return 'revision_net_delta';
  if (input.llmMode === 'delta') return 'llm_delta';
  if (input.transition) return 'transition';
  return 'legacy';
}

function resolveSummary(mode: ApplyReportV1['mode'], input: BuildApplyReportV1Input): ApplyReportV1['delta']['summary'] {
  if (mode === 'llm_delta') return normalizeSummary(input.llmDelta?.deltaSummary ?? null);
  if (mode === 'revision_net_delta') {
    return normalizeSummary(input.revisionNetDeltaReport?.deltaSummary ?? input.transition?.deltaSummary ?? null);
  }
  return normalizeSummary(input.transition?.deltaSummary ?? null);
}

function resolveIdentity(
  mode: ApplyReportV1['mode'],
  input: BuildApplyReportV1Input
): ApplyReportV1['identity'] {
  if (mode === 'llm_delta') {
    return {
      stateHashBefore: input.llmDelta?.stateHashBefore ?? input.transition?.stateHashBefore ?? null,
      stateHashAfter: input.llmDelta?.stateHashAfter ?? input.transition?.stateHashAfter ?? null,
      baseRevisionId: input.baseRevisionId ?? null,
      targetRevisionId: input.targetRevisionId ?? null,
    };
  }

  if (mode === 'revision_net_delta') {
    return {
      stateHashBefore: input.revisionNetDeltaReport?.stateHashBefore ?? input.transition?.stateHashBefore ?? null,
      stateHashAfter: input.revisionNetDeltaReport?.stateHashAfter ?? input.transition?.stateHashAfter ?? null,
      baseRevisionId: input.revisionNetDelta?.fromRevisionId ?? input.baseRevisionId ?? null,
      targetRevisionId: input.revisionNetDelta?.toRevisionId ?? input.targetRevisionId ?? null,
    };
  }

  return {
    stateHashBefore: input.transition?.stateHashBefore ?? null,
    stateHashAfter: input.transition?.stateHashAfter ?? null,
    baseRevisionId: input.baseRevisionId ?? null,
    targetRevisionId: input.targetRevisionId ?? null,
  };
}

function resolveConflictSurface(
  mode: ApplyReportV1['mode'],
  input: BuildApplyReportV1Input
): ApplyReportV1['conflictSurface'] {
  if (mode === 'llm_delta') {
    return {
      conflicts: normalizeConflictSurface(input.llmDelta?.conflicts),
      postApplyConflicts: normalizeConflictSurface(input.llmDelta?.postApplyConflicts),
    };
  }

  return {
    conflicts: normalizeConflictSurface(input.transition?.conflicts),
    postApplyConflicts: normalizeConflictSurface(input.transition?.postApplyConflicts),
  };
}

export function buildApplyReportV1(input: BuildApplyReportV1Input): ApplyReportV1 {
  const mode = resolveMode(input);

  return {
    schema: 'apply-report-1',
    mode,
    execution: {
      llmMode: input.llmMode ?? 'legacy',
      transitionMode: input.transitionMode ?? null,
      revisionNetDelta: input.revisionNetDelta ?? null,
      usedInjectedDelta: input.usedInjectedDelta === true,
    },
    identity: resolveIdentity(mode, input),
    delta: {
      summary: resolveSummary(mode, input),
    },
    transition: {
      appliedCounts: normalizePerDomainCounts(input.transition?.appliedCounts),
      rejectedCounts: normalizePerDomainCounts(input.transition?.rejectedCounts),
    },
    conflictSurface: resolveConflictSurface(mode, input),
    findings: normalizeFindings(input.transition?.findings),
    determinism: {
      sorted: true,
      domainOrder: ['facts', 'decisions', 'constraints', 'risks', 'assumptions'],
    },
  };
}
