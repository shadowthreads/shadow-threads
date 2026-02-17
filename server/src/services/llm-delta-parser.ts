import { canonicalizeDeep, computeUnitKey, stableHash } from '../algebra/semanticDiff/key';
import type { DomainDelta, DomainName, FieldChange, SemanticDelta } from '../algebra/semanticDiff/types';

type LLMDeltaErrorCode = 'E_LLM_DELTA_INVALID' | 'E_LLM_DELTA_UNSUPPORTED' | 'E_LLM_DELTA_NON_JSON_SAFE';
type LLMDeltaError = Error & { code: LLMDeltaErrorCode };

const DOMAIN_ORDER: DomainName[] = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];
const FIELD_OP_ORDER: Record<FieldChange['op'], number> = {
  set: 0,
  unset: 1,
  append: 2,
  remove: 3,
};

function makeLLMDeltaError(code: LLMDeltaErrorCode, message: string): LLMDeltaError {
  const error = new Error(message) as LLMDeltaError;
  error.code = code;
  return error;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw makeLLMDeltaError('E_LLM_DELTA_INVALID', 'LLM delta is invalid');
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw makeLLMDeltaError('E_LLM_DELTA_INVALID', 'LLM delta is invalid');
  }
  return value;
}

function ensureJsonSafe(value: unknown): void {
  try {
    canonicalizeDeep(value);
  } catch {
    throw makeLLMDeltaError('E_LLM_DELTA_NON_JSON_SAFE', 'LLM delta contains non JSON-safe value');
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = value.filter((item): item is string => typeof item === 'string');
  return [...new Set(out)].sort();
}

function deriveAddedKey(domain: DomainName, item: Record<string, unknown>): string {
  if (typeof item.key === 'string' && item.key.trim().length > 0) return item.key;
  if (!Object.prototype.hasOwnProperty.call(item, 'unit')) {
    throw makeLLMDeltaError('E_LLM_DELTA_INVALID', 'LLM delta is invalid');
  }
  return computeUnitKey(domain, item.unit);
}

function deriveRemovedKey(domain: DomainName, item: Record<string, unknown>): string {
  if (typeof item.key === 'string' && item.key.trim().length > 0) return item.key;
  if (!Object.prototype.hasOwnProperty.call(item, 'unit')) {
    throw makeLLMDeltaError('E_LLM_DELTA_INVALID', 'LLM delta is invalid');
  }
  return computeUnitKey(domain, item.unit);
}

function deriveModifiedKey(domain: DomainName, item: Record<string, unknown>): string {
  if (typeof item.key === 'string' && item.key.trim().length > 0) return item.key;
  if (Object.prototype.hasOwnProperty.call(item, 'before')) {
    return computeUnitKey(domain, item.before);
  }
  if (Object.prototype.hasOwnProperty.call(item, 'after')) {
    return computeUnitKey(domain, item.after);
  }
  throw makeLLMDeltaError('E_LLM_DELTA_INVALID', 'LLM delta is invalid');
}

function normalizePath(path: unknown): string {
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw makeLLMDeltaError('E_LLM_DELTA_UNSUPPORTED', 'LLM delta contains unsupported operations');
  }
  return path;
}

function normalizeFieldChange(input: unknown): FieldChange {
  const record = asRecord(input);
  const path = normalizePath(record.path);
  const op = record.op;

  if (op !== 'set' && op !== 'unset' && op !== 'append' && op !== 'remove') {
    throw makeLLMDeltaError('E_LLM_DELTA_UNSUPPORTED', 'LLM delta contains unsupported operations');
  }

  if (op === 'append' || op === 'remove') {
    if (!Object.prototype.hasOwnProperty.call(record, 'value')) {
      throw makeLLMDeltaError('E_LLM_DELTA_UNSUPPORTED', 'LLM delta contains unsupported operations');
    }
    ensureJsonSafe(record.value);
    return { path, op, value: record.value };
  }

  if (Object.prototype.hasOwnProperty.call(record, 'before')) {
    ensureJsonSafe(record.before);
  }
  if (Object.prototype.hasOwnProperty.call(record, 'after')) {
    ensureJsonSafe(record.after);
  }
  if (Object.prototype.hasOwnProperty.call(record, 'value')) {
    ensureJsonSafe(record.value);
  }

  if (op === 'set') {
    if (Object.prototype.hasOwnProperty.call(record, 'after')) {
      return { path, op, after: record.after, before: record.before };
    }
    if (Object.prototype.hasOwnProperty.call(record, 'value')) {
      return { path, op, value: record.value, before: record.before };
    }
    throw makeLLMDeltaError('E_LLM_DELTA_UNSUPPORTED', 'LLM delta contains unsupported operations');
  }

  return Object.prototype.hasOwnProperty.call(record, 'before')
    ? { path, op, before: record.before }
    : { path, op };
}

function compareFieldChange(a: FieldChange, b: FieldChange): number {
  const opDiff = FIELD_OP_ORDER[a.op] - FIELD_OP_ORDER[b.op];
  if (a.path !== b.path) return a.path.localeCompare(b.path);
  if (opDiff !== 0) return opDiff;

  const av = a.op === 'append' || a.op === 'remove' ? stableHash(a.value) : '';
  const bv = b.op === 'append' || b.op === 'remove' ? stableHash(b.value) : '';
  return av.localeCompare(bv);
}

function normalizeDomain(domain: DomainName, input: unknown): DomainDelta<unknown> {
  const record = asRecord(input);
  const addedInput = asArray(record.added);
  const removedInput = asArray(record.removed);
  const modifiedInput = asArray(record.modified);

  const added = addedInput.map((item) => {
    const obj = asRecord(item);
    if (!Object.prototype.hasOwnProperty.call(obj, 'unit')) {
      throw makeLLMDeltaError('E_LLM_DELTA_INVALID', 'LLM delta is invalid');
    }
    ensureJsonSafe(obj.unit);
    const key = deriveAddedKey(domain, obj);
    return { key, unit: obj.unit };
  }).sort((a, b) => a.key.localeCompare(b.key) || stableHash(a.unit).localeCompare(stableHash(b.unit)));

  const removed = removedInput.map((item) => {
    const obj = asRecord(item);
    const key = deriveRemovedKey(domain, obj);
    if (Object.prototype.hasOwnProperty.call(obj, 'unit')) {
      ensureJsonSafe(obj.unit);
      return { key, unit: obj.unit };
    }
    return { key, unit: null };
  }).sort((a, b) => a.key.localeCompare(b.key));

  const modified = modifiedInput.map((item) => {
    const obj = asRecord(item);
    const key = deriveModifiedKey(domain, obj);
    const before = Object.prototype.hasOwnProperty.call(obj, 'before') ? obj.before : obj.after;
    const after = Object.prototype.hasOwnProperty.call(obj, 'after') ? obj.after : obj.before;
    if (before === undefined || after === undefined) {
      throw makeLLMDeltaError('E_LLM_DELTA_INVALID', 'LLM delta is invalid');
    }
    ensureJsonSafe(before);
    ensureJsonSafe(after);
    const changes = asArray(obj.changes).map(normalizeFieldChange).sort(compareFieldChange);
    return { key, before, after, changes };
  }).sort((a, b) => a.key.localeCompare(b.key));

  return { added, removed, modified };
}

function parseInput(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const raw = input.trim();

  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  try {
    return JSON.parse(candidate);
  } catch {
    throw makeLLMDeltaError('E_LLM_DELTA_INVALID', 'LLM delta is invalid');
  }
}

export function parseLLMDelta(input: unknown): SemanticDelta {
  const parsed = parseInput(input);
  const record = asRecord(parsed);

  if (record.schemaVersion !== 'sdiff-0.1') {
    throw makeLLMDeltaError('E_LLM_DELTA_INVALID', 'LLM delta is invalid');
  }

  const domains = Object.fromEntries(
    DOMAIN_ORDER.map((domain) => [domain, normalizeDomain(domain, record[domain])])
  ) as Record<DomainName, DomainDelta<unknown>>;

  const collisionsInput = asRecord(asRecord(record.meta).collisions ?? {});
  const collisions = {
    soft: normalizeStringArray(collisionsInput.soft),
    hard: normalizeStringArray(collisionsInput.hard),
  };

  const counts: Record<string, number> = {};
  for (const domain of DOMAIN_ORDER) {
    counts[`${domain}.added`] = domains[domain].added.length;
    counts[`${domain}.removed`] = domains[domain].removed.length;
    counts[`${domain}.modified`] = domains[domain].modified.length;
  }
  counts['collisions.soft'] = collisions.soft.length;
  counts['collisions.hard'] = collisions.hard.length;

  const baseRecord = asRecord(record.base ?? {});
  const targetRecord = asRecord(record.target ?? {});

  return {
    schemaVersion: 'sdiff-0.1',
    base: { revisionHash: typeof baseRecord.revisionHash === 'string' ? baseRecord.revisionHash : '' },
    target: { revisionHash: typeof targetRecord.revisionHash === 'string' ? targetRecord.revisionHash : '' },
    facts: domains.facts,
    decisions: domains.decisions,
    constraints: domains.constraints,
    risks: domains.risks,
    assumptions: domains.assumptions,
    meta: {
      determinism: {
        canonicalVersion: 'tpkg-0.2-canon-v1',
        keyStrategy: 'sig-hash-v1',
        tieBreakers: ['llm-delta-parser-v1'],
      },
      collisions,
      counts,
    },
  };
}

export function isSemanticDelta(input: unknown): input is SemanticDelta {
  try {
    parseLLMDelta(input);
    return true;
  } catch {
    return false;
  }
}
