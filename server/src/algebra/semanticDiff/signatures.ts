import { type DomainName } from './types';

function asRecord(unit: unknown): Record<string, unknown> {
  if (!unit || typeof unit !== 'object' || Array.isArray(unit)) return {};
  return unit as Record<string, unknown>;
}

function token(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const out = String(value).trim();
  return out.length > 0 ? out : undefined;
}

function firstToken(unit: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const out = token(unit[key]);
    if (out) return out;
  }
  return undefined;
}

function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function factSig(unit: Record<string, unknown>): Record<string, unknown> {
  const idLike = firstToken(unit, ['key', 'factId', 'id', 'entityKey']);
  if (idLike) return { id: idLike };

  const subject = token(unit.subject);
  const predicate = token(unit.predicate);
  if (subject || predicate) return compact({ subject, predicate });

  const type = token(unit.type);
  const title = token(unit.title);
  if (type || title) return compact({ type, title });

  return { domain: 'facts' };
}

function decisionSig(unit: Record<string, unknown>): Record<string, unknown> {
  const idLike = firstToken(unit, ['key', 'decisionId', 'id']);
  if (idLike) return { id: idLike };

  const question = token(unit.question);
  if (question) return { question };

  const title = token(unit.title);
  if (title) return { title };

  return { domain: 'decisions' };
}

function constraintSig(unit: Record<string, unknown>): Record<string, unknown> {
  const idLike = firstToken(unit, ['key', 'constraintId', 'id']);
  if (idLike) return { id: idLike };

  const name = token(unit.name);
  if (name) return { name };

  const scope = token(unit.scope);
  const rule = token(unit.rule);
  if (scope || rule) return compact({ scope, rule });

  return { domain: 'constraints' };
}

function riskSig(unit: Record<string, unknown>): Record<string, unknown> {
  const idLike = firstToken(unit, ['key', 'riskId', 'id']);
  if (idLike) return { id: idLike };

  const title = token(unit.title);
  if (title) return { title };

  const risk = token(unit.risk);
  const impactArea = token(unit.impactArea);
  if (risk || impactArea) return compact({ risk, impactArea });

  return { domain: 'risks' };
}

function assumptionSig(unit: Record<string, unknown>): Record<string, unknown> {
  const idLike = firstToken(unit, ['key', 'assumptionId', 'id']);
  if (idLike) return { id: idLike };

  const statement = token(unit.statement);
  if (statement) return { statement };

  const topic = token(unit.topic);
  if (topic || statement) return compact({ topic, statement });

  return { domain: 'assumptions' };
}

export function buildSig(domain: DomainName, unit: unknown): Record<string, unknown> {
  const record = asRecord(unit);
  switch (domain) {
    case 'facts':
      return factSig(record);
    case 'decisions':
      return decisionSig(record);
    case 'constraints':
      return constraintSig(record);
    case 'risks':
      return riskSig(record);
    case 'assumptions':
      return assumptionSig(record);
    default:
      return { domain };
  }
}
