import { createHash } from 'crypto';

type CanonicalJsonValue =
  | null
  | string
  | number
  | boolean
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeForCanonicalJson(value: unknown): CanonicalJsonValue {
  if (value === null) return null;

  const kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return value as string | boolean;
  if (kind === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Invalid JSON value for canonicalization');
    }
    return value as number;
  }

  if (kind === 'undefined' || kind === 'function' || kind === 'symbol' || kind === 'bigint') {
    throw new Error('Invalid JSON value for canonicalization');
  }

  if (Array.isArray(value)) {
    const normalizedItems: CanonicalJsonValue[] = [];
    for (const item of value) {
      normalizedItems.push(normalizeForCanonicalJson(item));
    }
    return normalizedItems;
  }

  if (!isPlainObject(value)) {
    throw new Error('Invalid JSON value for canonicalization');
  }

  const normalizedObject: { [key: string]: CanonicalJsonValue } = {};
  const keys = Object.keys(value).sort(compareStrings);
  for (const key of keys) {
    normalizedObject[key] = normalizeForCanonicalJson(value[key]);
  }

  return normalizedObject;
}

/**
 * Deterministic JSON canonicalization:
 * - object keys are sorted lexicographically at every level
 * - array order is preserved
 * - invalid JSON values are rejected
 */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(normalizeForCanonicalJson(value));
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Computes the protocol bundle hash from canonicalized content:
 * { schema, identity: { packageId, revisionId, revisionHash }, payload }
 */
export function computeBundleHash(params: {
  schema: string;
  packageId: string;
  revisionId?: string | null;
  revisionHash?: string | null;
  payload: unknown;
}): string {
  const hashInput = {
    schema: params.schema,
    identity: {
      packageId: params.packageId,
      revisionId: params.revisionId ?? null,
      revisionHash: params.revisionHash ?? null,
    },
    payload: params.payload,
  };

  return sha256Hex(canonicalizeJson(hashInput));
}

