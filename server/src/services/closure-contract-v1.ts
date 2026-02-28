import { createHash } from 'crypto';
import type { SemanticDelta } from '../algebra/semanticDiff/types';

const DOMAIN_ORDER = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'] as const;

type DomainNameLike = (typeof DOMAIN_ORDER)[number] | string;

export type ClosureActionType =
  | 'ADD_MISSING_DEP'
  | 'REQUEST_HUMAN_CONFIRM'
  | 'PROMOTE_TO_L3_REVIEW'
  | 'SPLIT_PATCH'
  | 'RETRY_WITH_CONTEXT';

export type ClosureSuggestionV1 = {
  schema: 'closure-suggestion-1';
  code: string;
  message: string;
  actionType: ClosureActionType;
  payload: unknown;
  riskLevel?: 'L0' | 'L1' | 'L2' | 'L3';
};

export type RejectedPatchSummaryV1 = {
  domain: string;
  key: string;
  path: string | null;
  op: string;
};

export type ClosureRejectedV1 = {
  reasonCode: string;
  reasonMessage: string;
  riskLevel: 'L0' | 'L1' | 'L2' | 'L3';
  blockedBy: Array<{ domain: string; key: string; path: string | null }>;
  patch: RejectedPatchSummaryV1;
};

export type AcceptedDeltaSummaryV1 = {
  acceptedCount: number;
  rejectedCount: number;
  acceptedHash: string;
  proposedHash: string;
};

export type ClosureDiagnosticsV1 = {
  closureViolationFlag: boolean;
  maxClosureSizeRatio?: number;
  blockedByRate?: number;
  rejectedCount?: number;
  suggestionCoverageRate?: number;
  suggestionActionabilityRate?: number;
  l3EscalationRate?: number;
};

export type ClosureContractV1 = {
  schema: 'closure-contract-1';
  accepted: AcceptedDeltaSummaryV1;
  rejected: ClosureRejectedV1[];
  suggestions: ClosureSuggestionV1[];
  diagnostics: ClosureDiagnosticsV1;
};

type BuildRejectedInput = {
  domain: DomainNameLike;
  key?: string | null;
  path?: string | null;
  op: string;
  reasonCode: string;
  reasonMessage: string;
  riskLevel: 'L0' | 'L1' | 'L2' | 'L3';
  blockedBy?: Array<{ domain: DomainNameLike; key?: string | null; path?: string | null }> | null;
};

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareDomains(a: string, b: string): number {
  const leftIndex = DOMAIN_ORDER.indexOf(a as (typeof DOMAIN_ORDER)[number]);
  const rightIndex = DOMAIN_ORDER.indexOf(b as (typeof DOMAIN_ORDER)[number]);
  const leftRank = leftIndex >= 0 ? leftIndex : DOMAIN_ORDER.length;
  const rightRank = rightIndex >= 0 ? rightIndex : DOMAIN_ORDER.length;
  if (leftRank < rightRank) return -1;
  if (leftRank > rightRank) return 1;
  return compareStrings(a, b);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function assertJsonSafe(value: unknown): void {
  if (value === null) return;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return;
  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Contract contains non JSON-safe value');
    }
    return;
  }
  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
    throw new Error('Contract contains non JSON-safe value');
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      assertJsonSafe(entry);
    }
    return;
  }

  if (!isPlainObject(value)) {
    throw new Error('Contract contains non JSON-safe value');
  }

  const keys = Object.keys(value).sort(compareStrings);
  for (const key of keys) {
    assertJsonSafe(value[key]);
  }
}

export function stableStringify(value: unknown): string {
  assertJsonSafe(value);

  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareStrings);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function sha256Hex(str: string): string {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

function normalizeBlockedBy(blockedBy: BuildRejectedInput['blockedBy']): Array<{ domain: string; key: string; path: string | null }> {
  return [...(blockedBy ?? [])]
    .map((entry) => ({
      domain: entry.domain,
      key: entry.key ?? 'NULL',
      path: entry.path ?? null,
    }))
    .sort((left, right) => {
      return (
        compareDomains(left.domain, right.domain) ||
        compareStrings(left.key, right.key) ||
        compareStrings(left.path ?? 'NULL', right.path ?? 'NULL')
      );
    });
}

function normalizeRejected(rejected: BuildRejectedInput[]): ClosureRejectedV1[] {
  return [...rejected]
    .map((entry) => ({
      reasonCode: entry.reasonCode,
      reasonMessage: entry.reasonMessage,
      riskLevel: entry.riskLevel,
      blockedBy: normalizeBlockedBy(entry.blockedBy),
      patch: {
        domain: entry.domain,
        key: entry.key ?? 'NULL',
        path: entry.path ?? null,
        op: entry.op,
      },
    }))
    .sort((left, right) => {
      return (
        compareDomains(left.patch.domain, right.patch.domain) ||
        compareStrings(left.patch.key, right.patch.key) ||
        compareStrings(left.patch.path ?? 'NULL', right.patch.path ?? 'NULL') ||
        compareStrings(left.patch.op, right.patch.op) ||
        compareStrings(left.reasonCode, right.reasonCode) ||
        compareStrings(left.riskLevel, right.riskLevel)
      );
    });
}

function normalizeSuggestions(suggestions: ClosureSuggestionV1[]): ClosureSuggestionV1[] {
  return [...suggestions]
    .map((entry): ClosureSuggestionV1 => ({
      schema: 'closure-suggestion-1',
      code: entry.code,
      message: entry.message,
      actionType: entry.actionType,
      payload: entry.payload,
      ...(entry.riskLevel ? { riskLevel: entry.riskLevel } : {}),
    }))
    .sort((left, right) => {
      return (
        compareStrings(left.actionType, right.actionType) ||
        compareStrings(left.code, right.code) ||
        compareStrings(stableStringify(left.payload), stableStringify(right.payload)) ||
        compareStrings(left.message, right.message) ||
        compareStrings(left.riskLevel ?? '', right.riskLevel ?? '')
      );
    });
}

function countDeltaEntries(delta: SemanticDelta): number {
  let total = 0;
  for (const domain of DOMAIN_ORDER) {
    const domainDelta = delta[domain];
    total += domainDelta.added.length;
    total += domainDelta.removed.length;
    total += domainDelta.modified.length;
  }
  return total;
}

function rejectedCoverageKey(entry: ClosureRejectedV1): string {
  return `${entry.patch.domain}|${entry.patch.key}|${entry.patch.path ?? 'NULL'}|${entry.patch.op}`;
}

function suggestionCoverageKey(entry: ClosureSuggestionV1): string {
  const payload = isPlainObject(entry.payload) ? entry.payload : {};
  const appliesTo = isPlainObject(payload.appliesTo) ? payload.appliesTo : {};
  const domain = typeof appliesTo.domain === 'string' ? appliesTo.domain : 'NULL';
  const key = typeof appliesTo.key === 'string' ? appliesTo.key : 'NULL';
  const pathValue = typeof appliesTo.path === 'string' ? appliesTo.path : appliesTo.path === null ? 'NULL' : 'NULL';
  const op = typeof appliesTo.op === 'string' ? appliesTo.op : 'NULL';
  return `${domain}|${key}|${pathValue}|${op}`;
}

export function buildClosureContractV1(args: {
  proposedDelta: SemanticDelta;
  acceptedDelta: SemanticDelta;
  rejected: BuildRejectedInput[];
  suggestions: ClosureSuggestionV1[];
  diagnostics: {
    closureViolationFlag: boolean;
    maxClosureSizeRatio?: number;
    blockedByRate?: number;
    rejectedCount?: number;
  };
}): ClosureContractV1 {
  const rejected = normalizeRejected(args.rejected);
  const suggestions = normalizeSuggestions(args.suggestions);
  const rejectedKeys = new Set(rejected.map(rejectedCoverageKey));
  const coveredKeys = new Set<string>();
  const actionableKeys = new Set<string>();
  let l3RejectedCount = 0;
  let l3SuggestionCount = 0;

  for (const entry of rejected) {
    if (entry.riskLevel === 'L3') {
      l3RejectedCount += 1;
    }
  }

  for (const suggestion of suggestions) {
    const key = suggestionCoverageKey(suggestion);
    if (!rejectedKeys.has(key)) {
      continue;
    }

    coveredKeys.add(key);
    if (suggestion.actionType !== 'REQUEST_HUMAN_CONFIRM') {
      actionableKeys.add(key);
    }
    if (suggestion.actionType === 'PROMOTE_TO_L3_REVIEW') {
      l3SuggestionCount += 1;
    }
  }

  const rejectedCount = rejected.length;
  const contract: ClosureContractV1 = {
    schema: 'closure-contract-1',
    accepted: {
      acceptedCount: countDeltaEntries(args.acceptedDelta),
      rejectedCount,
      acceptedHash: sha256Hex(stableStringify(args.acceptedDelta)),
      proposedHash: sha256Hex(stableStringify(args.proposedDelta)),
    },
    rejected,
    suggestions,
    diagnostics: {
      closureViolationFlag: args.diagnostics.closureViolationFlag,
      ...(args.diagnostics.maxClosureSizeRatio !== undefined ? { maxClosureSizeRatio: args.diagnostics.maxClosureSizeRatio } : {}),
      ...(args.diagnostics.blockedByRate !== undefined ? { blockedByRate: args.diagnostics.blockedByRate } : {}),
      ...(args.diagnostics.rejectedCount !== undefined ? { rejectedCount: args.diagnostics.rejectedCount } : {}),
      suggestionCoverageRate: rejectedCount === 0 ? 1 : coveredKeys.size / rejectedCount,
      suggestionActionabilityRate: rejectedCount === 0 ? 1 : actionableKeys.size / rejectedCount,
      l3EscalationRate: l3RejectedCount === 0 ? 0 : l3SuggestionCount / l3RejectedCount,
    },
  };

  assertJsonSafe(contract);
  return contract;
}
