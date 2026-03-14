import type { DomainName } from '../algebra/semanticDiff/types';
import type { RiskLevel, RiskPolicyV1 } from './delta-risk-policy';
import type { ClosureActionType, ClosureSuggestionV1 } from './closure-contract-v1';

const DOMAIN_ORDER: DomainName[] = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];
const ACTION_ORDER: ClosureActionType[] = [
  'ADD_MISSING_DEP',
  'REQUEST_HUMAN_CONFIRM',
  'SPLIT_PATCH',
  'RETRY_WITH_CONTEXT',
  'PROMOTE_TO_L3_REVIEW',
];
const DEFAULT_MAX_SUGGESTIONS = 64;

type RejectedInput = {
  domain: DomainName;
  key?: string | null;
  path?: string | null;
  op?: string | null;
  reasonCode: string;
  blockedBy?: Array<{ domain: DomainName; key?: string | null; path?: string | null }> | null;
  riskLevel: RiskLevel;
};

export type { ClosureSuggestionV1 } from './closure-contract-v1';

function makeError(code: 'E_SUGGESTION_INPUT_INVALID' | 'E_SUGGESTION_NON_JSON_SAFE', message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareDomains(a: DomainName, b: DomainName): number {
  return DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b) || compareStrings(a, b);
}

function isDomainName(value: unknown): value is DomainName {
  return value === 'facts' || value === 'decisions' || value === 'constraints' || value === 'risks' || value === 'assumptions';
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === 'L0' || value === 'L1' || value === 'L2' || value === 'L3';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isJsonSafe(value: unknown): boolean {
  if (value === null) return true;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return true;
  if (valueType === 'number') return Number.isFinite(value);
  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') return false;
  if (Array.isArray(value)) return value.every((entry) => isJsonSafe(entry));
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (!isJsonSafe(value[key])) return false;
  }
  return true;
}

function ensureJsonSafe(value: unknown): void {
  if (!isJsonSafe(value)) {
    throw makeError('E_SUGGESTION_NON_JSON_SAFE', 'Suggestion contains non JSON-safe value');
  }
}

function normalizeBlockedBy(
  blockedBy: RejectedInput['blockedBy']
): Array<{ domain: DomainName; key?: string | null; path?: string | null }> {
  if (!Array.isArray(blockedBy) || blockedBy.length === 0) return [];

  return blockedBy
    .filter((entry) => entry && isDomainName(entry.domain))
    .map((entry) => ({
      domain: entry.domain,
      key: typeof entry.key === 'string' ? entry.key : null,
      path: typeof entry.path === 'string' ? entry.path : null,
    }))
    .sort((left, right) => {
      return (
        compareDomains(left.domain, right.domain) ||
        compareStrings(left.key ?? 'NULL', right.key ?? 'NULL') ||
        compareStrings(left.path ?? 'NULL', right.path ?? 'NULL')
      );
    });
}

function compareSuggestions(a: ClosureSuggestionV1, b: ClosureSuggestionV1): number {
  const left = isPlainObject(a.payload) ? a.payload : {};
  const right = isPlainObject(b.payload) ? b.payload : {};
  const leftAppliesTo = isPlainObject(left.appliesTo) ? left.appliesTo : {};
  const rightAppliesTo = isPlainObject(right.appliesTo) ? right.appliesTo : {};
  const leftDomain = isDomainName(leftAppliesTo.domain) ? leftAppliesTo.domain : 'facts';
  const rightDomain = isDomainName(rightAppliesTo.domain) ? rightAppliesTo.domain : 'facts';

  return (
    compareDomains(leftDomain, rightDomain) ||
    compareStrings(typeof leftAppliesTo.key === 'string' ? leftAppliesTo.key : 'NULL', typeof rightAppliesTo.key === 'string' ? rightAppliesTo.key : 'NULL') ||
    compareStrings(typeof leftAppliesTo.path === 'string' ? leftAppliesTo.path : 'NULL', typeof rightAppliesTo.path === 'string' ? rightAppliesTo.path : 'NULL') ||
    ACTION_ORDER.indexOf(a.actionType) - ACTION_ORDER.indexOf(b.actionType) ||
    compareStrings(a.code, b.code)
  );
}

function makeMessage(actionType: ClosureActionType): string {
  if (actionType === 'ADD_MISSING_DEP') return 'Add missing dependency';
  if (actionType === 'REQUEST_HUMAN_CONFIRM') return 'Request human confirm';
  if (actionType === 'PROMOTE_TO_L3_REVIEW') return 'Requires L3 review';
  if (actionType === 'SPLIT_PATCH') return 'Split patch';
  return 'Retry with context';
}

function makeSuggestion(
  rejected: RejectedInput,
  actionType: ClosureActionType,
  blockedBy: Array<{ domain: DomainName; key?: string | null; path?: string | null }>
): ClosureSuggestionV1 {
  const payload = {
    appliesTo: {
      domain: rejected.domain,
      key: rejected.key ?? null,
      path: rejected.path ?? null,
      op: rejected.op ?? null,
    },
    blockedBy: blockedBy.length > 0 ? blockedBy : null,
  };

  ensureJsonSafe(payload);

  return {
    schema: 'closure-suggestion-1',
    code: actionType,
    message: makeMessage(actionType),
    actionType,
    payload,
    riskLevel: rejected.riskLevel,
  };
}

function validateInput(input: {
  rejected: RejectedInput[];
  policy: RiskPolicyV1;
  limits?: { maxSuggestions?: number };
}): { rejected: RejectedInput[]; policy: RiskPolicyV1; maxSuggestions: number } {
  if (!input || !Array.isArray(input.rejected) || !input.policy || input.policy.schema !== 'risk-policy-1') {
    throw makeError('E_SUGGESTION_INPUT_INVALID', 'Suggestion input is invalid');
  }

  for (const rejected of input.rejected) {
    if (!rejected || !isDomainName(rejected.domain) || !isRiskLevel(rejected.riskLevel) || typeof rejected.reasonCode !== 'string') {
      throw makeError('E_SUGGESTION_INPUT_INVALID', 'Suggestion input is invalid');
    }
  }

  const rawLimit = input.limits && typeof input.limits.maxSuggestions === 'number' ? input.limits.maxSuggestions : DEFAULT_MAX_SUGGESTIONS;
  const maxSuggestions = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : DEFAULT_MAX_SUGGESTIONS;
  return { rejected: input.rejected, policy: input.policy, maxSuggestions };
}

export function buildClosureSuggestionsV1(input: {
  rejected: RejectedInput[];
  policy: RiskPolicyV1;
  limits?: { maxSuggestions?: number };
}): {
  suggestions: ClosureSuggestionV1[];
  diagnostics: { suggestionCount: number; coveredRejectedCount: number; blockedByCoveredCount: number };
} {
  const validated = validateInput(input);
  const suggestions: ClosureSuggestionV1[] = [];
  let coveredRejectedCount = 0;
  let blockedByCoveredCount = 0;

  for (const rejected of validated.rejected) {
    const blockedBy = normalizeBlockedBy(rejected.blockedBy);
    const actions: ClosureActionType[] = [];

    if (rejected.reasonCode === 'DEPENDENCY_BLOCKED' || blockedBy.length > 0) {
      actions.push('ADD_MISSING_DEP');
    } else if (rejected.reasonCode === 'CONFLICT') {
      actions.push('REQUEST_HUMAN_CONFIRM');
      actions.push('RETRY_WITH_CONTEXT');
    } else if (rejected.reasonCode === 'INVALID_OP' && rejected.op === 'modify' && validated.policy.strict.fieldLevelModify === 'on') {
      actions.push('SPLIT_PATCH');
    } else if (rejected.reasonCode === 'NON_JSON_SAFE') {
      actions.push('RETRY_WITH_CONTEXT');
    }

    if (rejected.riskLevel === 'L3') {
      actions.push('PROMOTE_TO_L3_REVIEW');
    }

    if (actions.length === 0) continue;

    coveredRejectedCount += 1;
    if (blockedBy.length > 0) {
      blockedByCoveredCount += blockedBy.length;
    }

    for (const actionType of actions) {
      suggestions.push(makeSuggestion(rejected, actionType, blockedBy));
    }
  }

  const ordered = [...suggestions].sort(compareSuggestions).slice(0, validated.maxSuggestions);
  ensureJsonSafe(ordered);

  return {
    suggestions: ordered,
    diagnostics: {
      suggestionCount: ordered.length,
      coveredRejectedCount,
      blockedByCoveredCount,
    },
  };
}
