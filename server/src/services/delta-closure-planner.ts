import { composeDelta } from '../algebra/deltaCompose/composeDelta';
import { computeUnitKey, stableHash } from '../algebra/semanticDiff/key';
import type { DomainDelta, DomainName, FieldChange, SemanticDelta } from '../algebra/semanticDiff/types';
import { applyDelta } from '../algebra/stateTransition/applyDelta';
import { detectConflicts } from '../algebra/stateTransition/detectConflicts';
import {
  DEFAULT_RISK_POLICY_V1,
  normalizeRiskPolicyV1,
  type RiskLevel,
  type RiskPolicyV1,
  type RiskRuleId,
} from './delta-risk-policy';
import { buildClosureSuggestionsV1, type ClosureSuggestionV1 } from './delta-suggestion-engine';

type CandidateOp = 'remove' | 'add' | 'set' | 'append' | 'modify';
type CandidateKind = 'add' | 'remove' | 'modify';

type Candidate = {
  id: string;
  kind: CandidateKind;
  domain: DomainName;
  key: string;
  path: string | null;
  op: CandidateOp;
  rawOp?: FieldChange['op'];
  delta: SemanticDelta;
  dependsOn: string[];
};

type CandidateReference = {
  domain: DomainName;
  key: string;
  path?: string;
  op?: CandidateOp;
};

type RejectedReasonCode =
  | 'CONFLICT'
  | 'DEPENDENCY_BLOCKED'
  | 'UNSAFE_PATH'
  | 'NON_JSON_SAFE'
  | 'INVALID_OP'
  | 'POST_APPLY_CONFLICT';

const DOMAIN_ORDER: DomainName[] = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];
const DOMAIN_RANK = new Map<DomainName, number>(DOMAIN_ORDER.map((domain, index) => [domain, index]));
const OP_RANK: Record<CandidateOp, number> = {
  remove: 0,
  add: 1,
  set: 2,
  append: 3,
  modify: 4,
};
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const RULE_ORDER: RiskRuleId[] = [
  'POST_APPLY_CONFLICT',
  'MISSING_KEY',
  'DUP_KEY_ADD',
  'INVARIANT_BREAK',
  'CROSS_DOMAIN_DEP',
  'UNKNOWN',
];

const REJECTED_REASON_MESSAGE: Record<RejectedReasonCode, string> = {
  CONFLICT: 'Rejected: conflict',
  DEPENDENCY_BLOCKED: 'Rejected: dependency blocked',
  UNSAFE_PATH: 'Rejected: unsafe path',
  NON_JSON_SAFE: 'Rejected: non JSON-safe value',
  INVALID_OP: 'Rejected: invalid operation',
  POST_APPLY_CONFLICT: 'Rejected: post-apply conflict',
};

export type ClosureSuggestion = ClosureSuggestionV1;

export type ClosureRejected = {
  domain: DomainName;
  key?: string;
  path?: string;
  op: string;
  reasonCode: RejectedReasonCode;
  reasonMessage: string;
  blockedBy?: Array<{ domain: DomainName; key?: string; path?: string }>;
  riskLevel: RiskLevel;
};

export type DeltaClosurePlan = {
  schema: 'delta-closure-plan-1';
  policy: RiskPolicyV1;
  acceptedDelta: SemanticDelta;
  rejected: ClosureRejected[];
  suggestions: ClosureSuggestionV1[];
  suggestionDiagnostics: {
    suggestionCount: number;
    coveredRejectedCount: number;
    blockedByCoveredCount: number;
  };
  diagnostics: {
    candidateCount: number;
    acceptedCount: number;
    rejectedCount: number;
    blockedByRate: number;
    maxClosureSizeRatio: number;
    closureViolationFlag: boolean;
  };
};

export type RejectedPatch = ClosureRejected;

type LegacyPlannerInput = {
  baseState: unknown;
  proposedDelta: SemanticDelta;
  mode: 'strict' | 'best_effort';
  policy: { requirePostApplyZeroConflicts: true };
};

type LegacyPlannerOutput = {
  acceptedDelta: SemanticDelta;
  rejected: ClosureRejected[];
  suggestions: ClosureSuggestionV1[];
  suggestionDiagnostics: DeltaClosurePlan['suggestionDiagnostics'];
  diagnostics: DeltaClosurePlan['diagnostics'];
};

type ExpansionResult = {
  candidates: Candidate[];
  immediateRejected: ClosureRejected[];
  candidateCount: number;
};

type ConflictOutcome = {
  reasonCode: RejectedReasonCode;
  ruleId: RiskRuleId;
};

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function round6(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isJsonSafe(value: unknown): boolean {
  try {
    stableHash(value);
    return true;
  } catch {
    return false;
  }
}

function compareCandidateRefs(a: CandidateReference, b: CandidateReference): number {
  return (
    (DOMAIN_RANK.get(a.domain) ?? 0) - (DOMAIN_RANK.get(b.domain) ?? 0) ||
    compareStrings(a.key, b.key) ||
    compareStrings(a.path ?? '\uffff', b.path ?? '\uffff') ||
    compareStrings(a.op ?? 'modify', b.op ?? 'modify')
  );
}

function compareRejected(a: ClosureRejected, b: ClosureRejected): number {
  return (
    (DOMAIN_RANK.get(a.domain) ?? 0) - (DOMAIN_RANK.get(b.domain) ?? 0) ||
    compareStrings(a.key ?? '', b.key ?? '') ||
    compareStrings(a.path ?? '\uffff', b.path ?? '\uffff') ||
    compareStrings(a.op, b.op) ||
    compareStrings(a.reasonCode, b.reasonCode)
  );
}

function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    (DOMAIN_RANK.get(a.domain) ?? 0) - (DOMAIN_RANK.get(b.domain) ?? 0) ||
    compareStrings(a.key, b.key) ||
    compareStrings(a.path ?? '\uffff', b.path ?? '\uffff') ||
    OP_RANK[a.op] - OP_RANK[b.op] ||
    compareStrings(a.id, b.id)
  );
}

function deriveKey(domain: DomainName, item: Record<string, unknown>): string | null {
  if (typeof item.key === 'string' && item.key.length > 0) return item.key;
  if (Object.prototype.hasOwnProperty.call(item, 'unit') && isJsonSafe(item.unit)) return computeUnitKey(domain, item.unit);
  if (Object.prototype.hasOwnProperty.call(item, 'before') && isJsonSafe(item.before)) return computeUnitKey(domain, item.before);
  if (Object.prototype.hasOwnProperty.call(item, 'after') && isJsonSafe(item.after)) return computeUnitKey(domain, item.after);
  return null;
}

function isUnsafePath(path: string): boolean {
  if (path.length === 0) return true;
  const parts = path.split('.');
  if (parts.some((part) => part.length === 0)) return true;
  return parts.some((part) => UNSAFE_PATH_SEGMENTS.has(part));
}

function isPathPrefix(parent: string, child: string): boolean {
  if (parent === child) return false;
  if (child.length <= parent.length) return false;
  return child.startsWith(`${parent}.`);
}

function emptyDomainDelta(): DomainDelta<unknown> {
  return { added: [], removed: [], modified: [] };
}

function makeCounts(delta: SemanticDelta): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const domain of DOMAIN_ORDER) {
    counts[`${domain}.added`] = delta[domain].added.length;
    counts[`${domain}.removed`] = delta[domain].removed.length;
    counts[`${domain}.modified`] = delta[domain].modified.length;
  }
  counts['collisions.soft'] = delta.meta.collisions.soft.length;
  counts['collisions.hard'] = delta.meta.collisions.hard.length;
  return counts;
}

function makeIdentityDelta(proposedDelta: SemanticDelta): SemanticDelta {
  return {
    schemaVersion: 'sdiff-0.1',
    base: { revisionHash: proposedDelta.base.revisionHash },
    target: { revisionHash: proposedDelta.target.revisionHash },
    facts: emptyDomainDelta(),
    decisions: emptyDomainDelta(),
    constraints: emptyDomainDelta(),
    risks: emptyDomainDelta(),
    assumptions: emptyDomainDelta(),
    meta: {
      determinism: {
        canonicalVersion: 'tpkg-0.2-canon-v1',
        keyStrategy: 'sig-hash-v1',
        tieBreakers: ['risk-closure-planner-v1'],
      },
      collisions: {
        hard: [],
        soft: [],
      },
      counts: {
        'facts.added': 0,
        'facts.removed': 0,
        'facts.modified': 0,
        'decisions.added': 0,
        'decisions.removed': 0,
        'decisions.modified': 0,
        'constraints.added': 0,
        'constraints.removed': 0,
        'constraints.modified': 0,
        'risks.added': 0,
        'risks.removed': 0,
        'risks.modified': 0,
        'assumptions.added': 0,
        'assumptions.removed': 0,
        'assumptions.modified': 0,
        'collisions.soft': 0,
        'collisions.hard': 0,
      },
    },
  };
}

function withCounts(delta: SemanticDelta): SemanticDelta {
  return {
    ...delta,
    meta: {
      ...delta.meta,
      counts: makeCounts(delta),
    },
  };
}

function makeCandidateDelta(proposedDelta: SemanticDelta): SemanticDelta {
  return makeIdentityDelta(proposedDelta);
}

function normalizeRiskLevel(policy: RiskPolicyV1, ruleId: RiskRuleId): RiskLevel {
  const rule = policy.classification.rules.find((entry) => entry.ruleId === ruleId);
  return rule ? rule.level : 'L1';
}

function toBlockedBy(candidate: Candidate[]): Array<{ domain: DomainName; key?: string; path?: string }> {
  return candidate
    .map((entry) => {
      const item: { domain: DomainName; key?: string; path?: string } = { domain: entry.domain };
      item.key = entry.key;
      if (entry.path) item.path = entry.path;
      return item;
    })
    .sort((left, right) => {
      return (
        (DOMAIN_RANK.get(left.domain) ?? 0) - (DOMAIN_RANK.get(right.domain) ?? 0) ||
        compareStrings(left.key ?? '', right.key ?? '') ||
        compareStrings(left.path ?? '\uffff', right.path ?? '\uffff')
      );
    });
}

function makeRejected(
  policy: RiskPolicyV1,
  candidate: Pick<Candidate, 'domain' | 'key' | 'path' | 'op'>,
  reasonCode: RejectedReasonCode,
  ruleId: RiskRuleId,
  blockedBy?: Candidate[]
): ClosureRejected {
  const rejected: ClosureRejected = {
    domain: candidate.domain,
    key: candidate.key,
    op: candidate.op,
    reasonCode,
    reasonMessage: REJECTED_REASON_MESSAGE[reasonCode],
    riskLevel: normalizeRiskLevel(policy, ruleId),
  };

  if (candidate.path) rejected.path = candidate.path;
  if (blockedBy && blockedBy.length > 0) {
    rejected.blockedBy = toBlockedBy(blockedBy);
  }

  return rejected;
}

function determineConflictOutcome(conflictCodes: string[]): ConflictOutcome {
  if (conflictCodes.some((code) => code === 'E_REMOVE_MISSING' || code === 'E_MODIFY_MISSING')) {
    return { reasonCode: 'CONFLICT', ruleId: 'MISSING_KEY' };
  }
  if (conflictCodes.some((code) => code === 'E_ADD_EXISTS' || code === 'E_MODIFY_KEY_COLLISION')) {
    return { reasonCode: 'CONFLICT', ruleId: 'DUP_KEY_ADD' };
  }
  return { reasonCode: 'CONFLICT', ruleId: 'UNKNOWN' };
}

function uniqueSorted<T>(items: T[], compare: (a: T, b: T) => number, hash: (value: T) => string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of [...items].sort(compare)) {
    const key = hash(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function createCandidate(
  proposedDelta: SemanticDelta,
  domain: DomainName,
  key: string,
  kind: CandidateKind,
  op: CandidateOp,
  path: string | null,
  mutate: (delta: SemanticDelta) => void,
  rawOp?: FieldChange['op']
): Candidate {
  const delta = makeCandidateDelta(proposedDelta);
  mutate(delta);
  return {
    id: '',
    kind,
    domain,
    key,
    path,
    op,
    rawOp,
    delta: withCounts(delta),
    dependsOn: [],
  };
}

function expandCandidates(proposedDelta: SemanticDelta, policy: RiskPolicyV1): ExpansionResult {
  const candidates: Candidate[] = [];
  const immediateRejected: ClosureRejected[] = [];

  for (const domain of DOMAIN_ORDER) {
    const domainDelta = proposedDelta[domain];

    for (const rawItem of domainDelta.added) {
      const item = asRecord(rawItem);
      const key = deriveKey(domain, item);
      if (!key) {
        immediateRejected.push(makeRejected(policy, { domain, key: '', path: null, op: 'add' }, 'INVALID_OP', 'UNKNOWN'));
        continue;
      }
      if (!isJsonSafe(item.unit)) {
        immediateRejected.push(makeRejected(policy, { domain, key, path: null, op: 'add' }, 'NON_JSON_SAFE', 'UNKNOWN'));
        continue;
      }
      candidates.push(
        createCandidate(proposedDelta, domain, key, 'add', 'add', null, (delta) => {
          delta[domain].added.push({ key, unit: item.unit });
        })
      );
    }

    for (const rawItem of domainDelta.removed) {
      const item = asRecord(rawItem);
      const key = deriveKey(domain, item);
      if (!key) {
        immediateRejected.push(makeRejected(policy, { domain, key: '', path: null, op: 'remove' }, 'INVALID_OP', 'UNKNOWN'));
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(item, 'unit') && !isJsonSafe(item.unit)) {
        immediateRejected.push(makeRejected(policy, { domain, key, path: null, op: 'remove' }, 'NON_JSON_SAFE', 'UNKNOWN'));
        continue;
      }
      candidates.push(
        createCandidate(proposedDelta, domain, key, 'remove', 'remove', null, (delta) => {
          delta[domain].removed.push({ key, unit: Object.prototype.hasOwnProperty.call(item, 'unit') ? item.unit : null });
        })
      );
    }

    for (const rawItem of domainDelta.modified) {
      const item = asRecord(rawItem);
      const key = deriveKey(domain, item);
      if (!key) {
        immediateRejected.push(makeRejected(policy, { domain, key: '', path: null, op: 'modify' }, 'INVALID_OP', 'UNKNOWN'));
        continue;
      }

      const before = Object.prototype.hasOwnProperty.call(item, 'before') ? item.before : item.after;
      const after = Object.prototype.hasOwnProperty.call(item, 'after') ? item.after : item.before;
      if (!isJsonSafe(before) || !isJsonSafe(after)) {
        immediateRejected.push(makeRejected(policy, { domain, key, path: null, op: 'modify' }, 'NON_JSON_SAFE', 'UNKNOWN'));
        continue;
      }

      const changes = asArray(item.changes);
      const splitByField = policy.strict.fieldLevelModify === 'on' && changes.length > 0;
      if (!splitByField) {
        candidates.push(
          createCandidate(proposedDelta, domain, key, 'modify', 'modify', null, (delta) => {
            delta[domain].modified.push({
              key,
              before,
              after,
              changes: changes as FieldChange[],
            });
          })
        );
        continue;
      }

      for (const rawChange of changes) {
        const change = asRecord(rawChange);
        const path = typeof change.path === 'string' ? change.path : '';
        const rawOp = change.op;
        if (rawOp !== 'set' && rawOp !== 'unset' && rawOp !== 'append' && rawOp !== 'remove') {
          immediateRejected.push(makeRejected(policy, { domain, key, path, op: 'modify' }, 'INVALID_OP', 'UNKNOWN'));
          continue;
        }
        if (isUnsafePath(path)) {
          immediateRejected.push(makeRejected(policy, { domain, key, path, op: 'modify' }, 'UNSAFE_PATH', 'INVARIANT_BREAK'));
          continue;
        }
        if ((rawOp === 'append' || rawOp === 'remove') && !Object.prototype.hasOwnProperty.call(change, 'value')) {
          immediateRejected.push(makeRejected(policy, { domain, key, path, op: rawOp }, 'INVALID_OP', 'UNKNOWN'));
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(change, 'value') && !isJsonSafe(change.value)) {
          immediateRejected.push(makeRejected(policy, { domain, key, path, op: rawOp === 'append' || rawOp === 'remove' ? rawOp : 'set' }, 'NON_JSON_SAFE', 'UNKNOWN'));
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(change, 'after') && !isJsonSafe(change.after)) {
          immediateRejected.push(makeRejected(policy, { domain, key, path, op: 'set' }, 'NON_JSON_SAFE', 'UNKNOWN'));
          continue;
        }

        const normalizedChange: FieldChange =
          rawOp === 'append' || rawOp === 'remove'
            ? { path, op: rawOp, value: change.value }
            : rawOp === 'set'
            ? Object.prototype.hasOwnProperty.call(change, 'after')
              ? { path, op: 'set', after: change.after, before: change.before }
              : Object.prototype.hasOwnProperty.call(change, 'value')
              ? { path, op: 'set', value: change.value, before: change.before }
              : { path, op: 'set' }
            : Object.prototype.hasOwnProperty.call(change, 'before')
            ? { path, op: 'unset', before: change.before }
            : { path, op: 'unset' };

        const op: CandidateOp =
          rawOp === 'append' ? 'append' : rawOp === 'remove' ? 'remove' : 'set';
        candidates.push(
          createCandidate(proposedDelta, domain, key, 'modify', op, path, (delta) => {
            delta[domain].modified.push({
              key,
              before,
              after,
              changes: [normalizedChange],
            });
          }, rawOp)
        );
      }
    }
  }

  candidates.sort(compareCandidates);
  for (let index = 0; index < candidates.length; index += 1) {
    candidates[index].id = `c${String(index + 1).padStart(6, '0')}`;
  }

  const byDomainKey = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const bucketKey = `${candidate.domain}|${candidate.key}`;
    const bucket = byDomainKey.get(bucketKey) ?? [];
    bucket.push(candidate);
    byDomainKey.set(bucketKey, bucket);
  }

  for (const bucket of byDomainKey.values()) {
    bucket.sort(compareCandidates);
    for (let index = 1; index < bucket.length; index += 1) {
      const current = bucket[index];
      const previous = bucket[index - 1];
      current.dependsOn.push(previous.id);
    }

    if (policy.strict.fieldLevelModify === 'on') {
      const fieldCandidates = bucket.filter((candidate) => candidate.path !== null);
      for (const child of fieldCandidates) {
        for (const parent of fieldCandidates) {
          if (parent.id === child.id || !parent.path || !child.path) continue;
          if (parent.rawOp !== 'set' && parent.rawOp !== 'unset') continue;
          if (!isPathPrefix(parent.path, child.path)) continue;
          if (!child.dependsOn.includes(parent.id)) child.dependsOn.push(parent.id);
        }
      }
    }
  }

  for (const candidate of candidates) {
    candidate.dependsOn = uniqueSorted(candidate.dependsOn, compareStrings, (value) => value);
  }

  return {
    candidates,
    immediateRejected: immediateRejected.sort(compareRejected),
    candidateCount: candidates.length + immediateRejected.length,
  };
}

function applyCandidateSequence(baseState: unknown, delta: SemanticDelta): { conflictCodes: string[]; postApplyConflictCount: number } {
  const transition = applyDelta(baseState, delta, { mode: 'best_effort' });
  const postApplyConflicts = detectConflicts(transition.nextState);
  return {
    conflictCodes: transition.conflicts.map((conflict) => conflict.code),
    postApplyConflictCount: postApplyConflicts.length,
  };
}

function buildPlan(baseState: unknown, proposedDelta: SemanticDelta, policy: RiskPolicyV1): DeltaClosurePlan {
  const expansion = expandCandidates(proposedDelta, policy);
  const acceptedIds = new Set<string>();
  const rejected: ClosureRejected[] = [...expansion.immediateRejected];
  const identity = makeIdentityDelta(proposedDelta);
  const byId = new Map(expansion.candidates.map((candidate) => [candidate.id, candidate]));
  let acceptedDelta = identity;

  for (const candidate of expansion.candidates) {
    const blockers = candidate.dependsOn
      .filter((dependencyId) => !acceptedIds.has(dependencyId))
      .map((dependencyId) => byId.get(dependencyId))
      .filter((dependency): dependency is Candidate => Boolean(dependency))
      .sort(compareCandidates);

    if (blockers.length > 0) {
      const hasCrossDomain = blockers.some((blocker) => blocker.domain !== candidate.domain);
      const ruleId: RiskRuleId = hasCrossDomain ? 'CROSS_DOMAIN_DEP' : 'UNKNOWN';
      const entry = makeRejected(policy, candidate, 'DEPENDENCY_BLOCKED', ruleId, blockers);
      rejected.push(entry);
      continue;
    }

    const tentative = composeDelta(acceptedDelta, candidate.delta);
    const outcome = applyCandidateSequence(baseState, tentative);

    if (outcome.conflictCodes.length > 0) {
      const conflictOutcome = determineConflictOutcome(outcome.conflictCodes);
      const entry = makeRejected(policy, candidate, conflictOutcome.reasonCode, conflictOutcome.ruleId);
      rejected.push(entry);
      continue;
    }

    if (policy.strict.requirePostApplyConflictsZero && outcome.postApplyConflictCount > 0) {
      rejected.push(makeRejected(policy, candidate, 'POST_APPLY_CONFLICT', 'POST_APPLY_CONFLICT'));
      continue;
    }

    acceptedIds.add(candidate.id);
    acceptedDelta = tentative;
  }

  const finalOutcome = applyCandidateSequence(baseState, acceptedDelta);
  const rejectedSorted = rejected.sort(compareRejected);
  const suggestionResult = buildClosureSuggestionsV1({
    rejected: rejectedSorted,
    policy,
    limits: { maxSuggestions: 64 },
  });
  const acceptedCount = acceptedIds.size;
  const rejectedCount = rejectedSorted.length;
  const candidateCount = expansion.candidateCount;
  const dependencyBlockedCount = rejectedSorted.filter((entry) => entry.reasonCode === 'DEPENDENCY_BLOCKED').length;

  return {
    schema: 'delta-closure-plan-1',
    policy,
    acceptedDelta: withCounts(acceptedDelta),
    rejected: rejectedSorted,
    suggestions: suggestionResult.suggestions,
    suggestionDiagnostics: suggestionResult.diagnostics,
    diagnostics: {
      candidateCount,
      acceptedCount,
      rejectedCount,
      blockedByRate: rejectedCount === 0 ? 0 : round6(dependencyBlockedCount / rejectedCount),
      maxClosureSizeRatio: candidateCount === 0 ? 1 : round6(acceptedCount / candidateCount),
      closureViolationFlag:
        finalOutcome.conflictCodes.length > 0 ||
        (policy.strict.requirePostApplyConflictsZero && finalOutcome.postApplyConflictCount > 0),
    },
  };
}

export function planDeltaClosureV1(input: {
  baseState: unknown;
  proposedDelta: SemanticDelta;
  mode: 'strict';
  policy?: RiskPolicyV1;
}): DeltaClosurePlan {
  const normalizedPolicy = normalizeRiskPolicyV1(input.policy);
  const effectivePolicy = normalizedPolicy ?? normalizeRiskPolicyV1(DEFAULT_RISK_POLICY_V1)!;
  return buildPlan(input.baseState, input.proposedDelta, effectivePolicy);
}

export function planDeltaClosure(input: LegacyPlannerInput): LegacyPlannerOutput {
  const legacyPolicy = {
    schema: DEFAULT_RISK_POLICY_V1.schema,
    strict: {
      requirePostApplyConflictsZero: true,
      fieldLevelModify: 'on',
      dependencyScope: 'same_domain',
      priority: 'acceptance',
      targetAcceptanceRatio: DEFAULT_RISK_POLICY_V1.strict.targetAcceptanceRatio,
    },
    classification: {
      rules: DEFAULT_RISK_POLICY_V1.classification.rules.map((rule) => ({ ...rule })),
    },
  } satisfies RiskPolicyV1;

  const plan = planDeltaClosureV1({
    baseState: input.baseState,
    proposedDelta: input.proposedDelta,
    mode: 'strict',
    policy: legacyPolicy,
  });

  return {
    acceptedDelta: plan.acceptedDelta,
    rejected: plan.rejected,
    suggestions: plan.suggestions,
    suggestionDiagnostics: plan.suggestionDiagnostics,
    diagnostics: plan.diagnostics,
  };
}
