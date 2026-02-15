import { computeUnitKey } from '../semanticDiff/key';
import type { DomainName } from '../semanticDiff/types';
import type { TransitionConflict } from './types';

const DOMAIN_ORDER: DomainName[] = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];
const DOMAIN_RANK = new Map<DomainName, number>(DOMAIN_ORDER.map((domain, index) => [domain, index]));

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getDomainUnits(state: unknown, domain: DomainName): unknown[] {
  const record = asRecord(state);
  const topLevel = asArray(record[domain]);
  if (topLevel.length > 0 || Array.isArray(record[domain])) return topLevel;
  return asArray(asRecord(record.state)[domain]);
}

function conflictSort(a: TransitionConflict, b: TransitionConflict): number {
  return (
    (DOMAIN_RANK.get(a.domain) ?? 0) - (DOMAIN_RANK.get(b.domain) ?? 0) ||
    a.code.localeCompare(b.code) ||
    (a.key ?? '').localeCompare(b.key ?? '') ||
    (a.path ?? '').localeCompare(b.path ?? '') ||
    a.message.localeCompare(b.message)
  );
}

function asLevel(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'low') return 1;
  if (normalized === 'medium') return 2;
  if (normalized === 'high') return 3;
  return null;
}

export function detectConflicts(state: unknown): TransitionConflict[] {
  const conflicts: TransitionConflict[] = [];

  for (const domain of DOMAIN_ORDER) {
    const units = getDomainUnits(state, domain);
    const keyCounts = new Map<string, number>();

    for (const unit of units) {
      const key = computeUnitKey(domain, unit);
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }

    for (const [key, count] of [...keyCounts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (count > 1) {
        conflicts.push({
          code: 'E_DUPLICATE_KEY',
          domain,
          key,
          message: `${domain} contains duplicate key (${count})`,
        });
      }
    }
  }

  const constraints = getDomainUnits(state, 'constraints');
  for (const constraint of constraints) {
    const record = asRecord(constraint);
    const key = computeUnitKey('constraints', constraint);
    const rule = record.rule;
    if (typeof rule !== 'string' || rule.trim() === '') {
      conflicts.push({
        code: 'E_CONSTRAINT_RULE_EMPTY',
        domain: 'constraints',
        key,
        path: 'rule',
        message: 'Constraint rule is empty',
      });
    }
  }

  const decisions = getDomainUnits(state, 'decisions');
  for (const decision of decisions) {
    const record = asRecord(decision);
    const key = computeUnitKey('decisions', decision);
    const isFinal = record.final === true || String(record.status ?? '').toLowerCase() === 'final';
    const answer = record.answer;
    const hasAnswer =
      (typeof answer === 'string' && answer.trim().length > 0) ||
      (typeof answer === 'number' && Number.isFinite(answer)) ||
      typeof answer === 'boolean';

    if (isFinal && !hasAnswer) {
      conflicts.push({
        code: 'E_DECISION_FINAL_NO_ANSWER',
        domain: 'decisions',
        key,
        path: 'answer',
        message: 'Final decision is missing answer',
      });
    }
  }

  const thresholds = constraints
    .map((constraint) => {
      const record = asRecord(constraint);
      return {
        key: computeUnitKey('constraints', constraint),
        maxProbability: asLevel(record.maxProbability),
        maxImpact: asLevel(record.maxImpact),
      };
    })
    .filter((threshold) => threshold.maxProbability !== null || threshold.maxImpact !== null);

  if (thresholds.length > 0) {
    const risks = getDomainUnits(state, 'risks');
    for (const risk of risks) {
      const riskRecord = asRecord(risk);
      const riskKey = computeUnitKey('risks', risk);
      const probability = asLevel(riskRecord.probability);
      const impact = asLevel(riskRecord.impact);

      for (const threshold of thresholds) {
        if (probability !== null && threshold.maxProbability !== null && probability > threshold.maxProbability) {
          conflicts.push({
            code: 'E_RISK_THRESHOLD_EXCEEDED',
            domain: 'risks',
            key: riskKey,
            path: 'probability',
            message: `Risk probability exceeds constraint ${threshold.key}`,
          });
        }
        if (impact !== null && threshold.maxImpact !== null && impact > threshold.maxImpact) {
          conflicts.push({
            code: 'E_RISK_THRESHOLD_EXCEEDED',
            domain: 'risks',
            key: riskKey,
            path: 'impact',
            message: `Risk impact exceeds constraint ${threshold.key}`,
          });
        }
      }
    }
  }

  return conflicts.sort(conflictSort);
}
