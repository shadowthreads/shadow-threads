import { stableHash } from '../algebra/semanticDiff/key';
import type { DomainName } from '../algebra/semanticDiff/types';
import type { RiskLevel, RiskPolicyV1 } from './delta-risk-policy';

const DOMAIN_ORDER: DomainName[] = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];
const KIND_ORDER: ClosureSuggestionV1['kind'][] = [
  'ADD_MISSING_DEP',
  'REMOVE_CONFLICTING_OP',
  'SPLIT_MODIFY',
  'PROMOTE_TO_L3_REVIEW',
];
const DEFAULT_MAX_SUGGESTIONS = 64;

export type ClosureSuggestionV1 = {
  schema: 'closure-suggestion-1';
  suggestionId: string;
  appliesTo: {
    domain: DomainName;
    key?: string | null;
    path?: string | null;
    op?: string | null;
  };
  kind: 'ADD_MISSING_DEP' | 'REMOVE_CONFLICTING_OP' | 'SPLIT_MODIFY' | 'PROMOTE_TO_L3_REVIEW';
  message: string;
  blockedBy?: Array<{ domain: DomainName; key?: string | null; path?: string | null }> | null;
  riskLevel: 'L0' | 'L1' | 'L2' | 'L3';
};

type RejectedInput = {
  domain: DomainName;
  key?: string | null;
  path?: string | null;
  op?: string | null;
  reasonCode: string;
  blockedBy?: Array<{ domain: DomainName; key?: string | null; path?: string | null }> | null;
  riskLevel: RiskLevel;
};

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

function normalizeIdPart(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) return 'NULL';
  return value.replace(/\s+/g, '_');
}

function isDomainName(value: unknown): value is DomainName {
  return value === 'facts' || value === 'decisions' || value === 'constraints' || value === 'risks' || value === 'assumptions';
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === 'L0' || value === 'L1' || value === 'L2' || value === 'L3';
}

function ensureJsonSafe(value: unknown): void {
  try {
    stableHash(value);
  } catch {
    throw makeError('E_SUGGESTION_NON_JSON_SAFE', 'Suggestion contains non JSON-safe value');
  }
}

function normalizeBlockedBy(
  blockedBy: RejectedInput['blockedBy']
): Array<{ domain: DomainName; key?: string | null; path?: string | null }> | null {
  if (!Array.isArray(blockedBy) || blockedBy.length === 0) return null;

  const normalized = blockedBy
    .filter((entry) => entry && isDomainName(entry.domain))
    .map((entry) => ({
      domain: entry.domain,
      key: typeof entry.key === 'string' ? entry.key : entry.key === null ? null : null,
      path: typeof entry.path === 'string' ? entry.path : entry.path === null ? null : null,
    }))
    .sort((left, right) => {
      return (
        compareDomains(left.domain, right.domain) ||
        compareStrings(left.key ?? 'NULL', right.key ?? 'NULL') ||
        compareStrings(left.path ?? '￿', right.path ?? '￿')
      );
    });

  return normalized.length > 0 ? normalized : null;
}

function compareSuggestions(a: ClosureSuggestionV1, b: ClosureSuggestionV1): number {
  return (
    compareDomains(a.appliesTo.domain, b.appliesTo.domain) ||
    compareStrings(a.appliesTo.key ?? 'NULL', b.appliesTo.key ?? 'NULL') ||
    compareStrings(a.appliesTo.path ?? '￿', b.appliesTo.path ?? '￿') ||
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
    compareStrings(a.suggestionId, b.suggestionId)
  );
}

function suggestionMessage(kind: ClosureSuggestionV1['kind']): string {
  if (kind === 'ADD_MISSING_DEP') return 'Add missing dependency';
  if (kind === 'REMOVE_CONFLICTING_OP') return 'Remove conflicting operation';
  if (kind === 'SPLIT_MODIFY') return 'Split modify into field-level patches';
  return 'Requires L3 review';
}

function makeSuggestion(
  rejected: RejectedInput,
  kind: ClosureSuggestionV1['kind']
): ClosureSuggestionV1 {
  const appliesTo = {
    domain: rejected.domain,
    key: rejected.key ?? null,
    path: rejected.path ?? null,
    op: rejected.op ?? null,
  };

  const suggestion: ClosureSuggestionV1 = {
    schema: 'closure-suggestion-1',
    suggestionId: `SUG_${rejected.domain}_${kind}_${normalizeIdPart(rejected.key ?? null)}_${normalizeIdPart(rejected.path ?? null)}`,
    appliesTo,
    kind,
    message: suggestionMessage(kind),
    blockedBy: kind === 'ADD_MISSING_DEP' ? normalizeBlockedBy(rejected.blockedBy) : null,
    riskLevel: rejected.riskLevel,
  };

  ensureJsonSafe(suggestion);
  return suggestion;
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

  const maxSuggestionsRaw = input.limits && typeof input.limits.maxSuggestions === 'number' ? input.limits.maxSuggestions : DEFAULT_MAX_SUGGESTIONS;
  const maxSuggestions = Number.isFinite(maxSuggestionsRaw) && maxSuggestionsRaw > 0 ? Math.floor(maxSuggestionsRaw) : DEFAULT_MAX_SUGGESTIONS;
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
    const kinds: ClosureSuggestionV1['kind'][] = [];

    if (rejected.reasonCode === 'DEPENDENCY_BLOCKED' || blockedBy !== null) {
      kinds.push('ADD_MISSING_DEP');
    }
    if (rejected.reasonCode === 'CONFLICT') {
      kinds.push('REMOVE_CONFLICTING_OP');
    }
    if (rejected.reasonCode === 'INVALID_OP' && rejected.op === 'modify' && validated.policy.strict.fieldLevelModify === 'on') {
      kinds.push('SPLIT_MODIFY');
    }
    if (rejected.riskLevel === 'L3') {
      kinds.push('PROMOTE_TO_L3_REVIEW');
    }

    if (kinds.length === 0) continue;
    coveredRejectedCount += 1;
    if (blockedBy !== null) {
      blockedByCoveredCount += blockedBy.length;
    }

    for (const kind of kinds) {
      suggestions.push(
        makeSuggestion(
          {
            ...rejected,
            blockedBy,
          },
          kind
        )
      );
    }
  }

  const unique = new Map<string, ClosureSuggestionV1>();
  for (const suggestion of suggestions) {
    if (!unique.has(suggestion.suggestionId)) {
      unique.set(suggestion.suggestionId, suggestion);
    }
  }

  const ordered = [...unique.values()].sort(compareSuggestions).slice(0, validated.maxSuggestions);
  const diagnostics = {
    suggestionCount: ordered.length,
    coveredRejectedCount,
    blockedByCoveredCount,
  };

  ensureJsonSafe(ordered);
  ensureJsonSafe(diagnostics);

  return {
    suggestions: ordered,
    diagnostics,
  };
}
