import type { DomainName } from '../algebra/semanticDiff/types';

export type RiskLevel = 'L0' | 'L1' | 'L2' | 'L3';
export type RiskRuleId =
  | 'POST_APPLY_CONFLICT'
  | 'MISSING_KEY'
  | 'DUP_KEY_ADD'
  | 'INVARIANT_BREAK'
  | 'CROSS_DOMAIN_DEP'
  | 'UNKNOWN';

export type RiskPolicyV1 = {
  schema: 'risk-policy-1';
  strict: {
    requirePostApplyConflictsZero: true;
    fieldLevelModify: 'off' | 'on';
    dependencyScope: 'same_domain' | 'cross_domain';
    priority: 'explainability' | 'acceptance';
    targetAcceptanceRatio: number;
  };
  classification: {
    rules: Array<{
      ruleId: RiskRuleId;
      level: RiskLevel;
    }>;
  };
};

const RULE_ORDER: RiskRuleId[] = [
  'POST_APPLY_CONFLICT',
  'MISSING_KEY',
  'DUP_KEY_ADD',
  'INVARIANT_BREAK',
  'CROSS_DOMAIN_DEP',
  'UNKNOWN',
];

const DOMAIN_ORDER: DomainName[] = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === 'L0' || value === 'L1' || value === 'L2' || value === 'L3';
}

function isRiskRuleId(value: unknown): value is RiskRuleId {
  return RULE_ORDER.includes(value as RiskRuleId);
}

function normalizeRules(input: unknown): RiskPolicyV1['classification']['rules'] | null {
  if (!Array.isArray(input)) return null;

  const byRule = new Map<RiskRuleId, RiskLevel>();
  for (const rawRule of input) {
    const rule = asRecord(rawRule);
    if (!isRiskRuleId(rule.ruleId) || !isRiskLevel(rule.level)) return null;
    byRule.set(rule.ruleId, rule.level);
  }

  const normalized = RULE_ORDER.map((ruleId) => ({
    ruleId,
    level: byRule.get(ruleId) ?? (ruleId === 'UNKNOWN' ? 'L1' : null),
  }));

  if (normalized.some((rule) => rule.level === null)) return null;

  return normalized.map((rule) => ({
    ruleId: rule.ruleId,
    level: rule.level as RiskLevel,
  }));
}

export const DEFAULT_RISK_POLICY_V1 = {
  schema: 'risk-policy-1',
  strict: {
    requirePostApplyConflictsZero: true,
    fieldLevelModify: 'off',
    dependencyScope: 'same_domain',
    priority: 'explainability',
    targetAcceptanceRatio: 0.75,
  },
  classification: {
    rules: [
      { ruleId: 'POST_APPLY_CONFLICT', level: 'L3' },
      { ruleId: 'MISSING_KEY', level: 'L2' },
      { ruleId: 'DUP_KEY_ADD', level: 'L2' },
      { ruleId: 'INVARIANT_BREAK', level: 'L3' },
      { ruleId: 'CROSS_DOMAIN_DEP', level: 'L2' },
      { ruleId: 'UNKNOWN', level: 'L1' },
    ],
  },
} as const satisfies RiskPolicyV1;

export function normalizeRiskPolicyV1(input?: RiskPolicyV1): RiskPolicyV1 | null {
  if (input === undefined) {
    return {
      schema: DEFAULT_RISK_POLICY_V1.schema,
      strict: { ...DEFAULT_RISK_POLICY_V1.strict },
      classification: {
        rules: DEFAULT_RISK_POLICY_V1.classification.rules.map((rule) => ({ ...rule })),
      },
    };
  }

  const record = asRecord(input);
  if (record.schema !== 'risk-policy-1') return null;

  const strict = asRecord(record.strict);
  if (strict.requirePostApplyConflictsZero !== true) return null;
  if (strict.fieldLevelModify !== 'off' && strict.fieldLevelModify !== 'on') return null;
  if (strict.dependencyScope !== 'same_domain' && strict.dependencyScope !== 'cross_domain') return null;
  if (strict.priority !== 'explainability' && strict.priority !== 'acceptance') return null;
  if (typeof strict.targetAcceptanceRatio !== 'number' || !Number.isFinite(strict.targetAcceptanceRatio)) return null;
  if (strict.targetAcceptanceRatio < 0 || strict.targetAcceptanceRatio > 1) return null;

  const classification = asRecord(record.classification);
  const rules = normalizeRules(classification.rules);
  if (!rules) return null;

  return {
    schema: 'risk-policy-1',
    strict: {
      requirePostApplyConflictsZero: true,
      fieldLevelModify: strict.fieldLevelModify,
      dependencyScope: strict.dependencyScope,
      priority: strict.priority,
      targetAcceptanceRatio: strict.targetAcceptanceRatio,
    },
    classification: {
      rules,
    },
  };
}

export function isRiskPolicyV1(input: unknown): input is RiskPolicyV1 {
  return normalizeRiskPolicyV1(input as RiskPolicyV1 | undefined) !== null;
}

export function compareDomainName(a: DomainName, b: DomainName): number {
  return DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b) || compareStrings(a, b);
}
