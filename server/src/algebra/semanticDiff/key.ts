import crypto from 'crypto';

import { buildSig } from './signatures';
import { type DomainName } from './types';

type CanonicalValue = string | number | boolean | null | CanonicalValue[] | { [key: string]: CanonicalValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deterministic canonicalization only supports JSON-safe values.
 * Unsupported runtime-specific values (Date, BigInt, Buffer, Function, Symbol, etc.)
 * are rejected so hash behavior stays explicit and deterministic.
 */
export function canonicalizeDeep(value: unknown): CanonicalValue {
  if (value === null) return null;

  const valueType = typeof value;

  if (valueType === 'string' || valueType === 'boolean') return value as string | boolean;

  if (valueType === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error('canonicalizeDeep: non-finite numbers are not JSON-safe.');
    }
    return value as number;
  }

  if (valueType === 'undefined' || valueType === 'bigint' || valueType === 'function' || valueType === 'symbol') {
    throw new Error(`canonicalizeDeep: unsupported type "${valueType}".`);
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeDeep(item));
  }

  if (!isPlainObject(value)) {
    throw new Error(`canonicalizeDeep: unsupported object type "${Object.prototype.toString.call(value)}".`);
  }

  const out: { [key: string]: CanonicalValue } = {};
  for (const key of Object.keys(value).sort()) {
    const nextValue = (value as Record<string, unknown>)[key];
    if (nextValue === undefined) continue;
    out[key] = canonicalizeDeep(nextValue);
  }
  return out;
}

export function stableStringify(input: unknown): string {
  return JSON.stringify(canonicalizeDeep(input));
}

export function stableHash(input: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(input)).digest('hex');
}

export function computeUnitKey(domain: DomainName, unit: unknown): string {
  return stableHash(buildSig(domain, unit));
}
