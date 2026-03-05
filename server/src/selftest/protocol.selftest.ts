import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

type ProtocolErrorCode =
  | 'ERR_PAYLOAD_TOO_LARGE'
  | 'ERR_PAYLOAD_UNSAFE_KEY'
  | 'ERR_PAYLOAD_CONTAINS_NULL_CHAR'
  | 'ERR_PAYLOAD_STRUCTURE_LIMIT'
  | 'ERR_ARTIFACT_HASH_COLLISION_OR_IMPL_BUG';

const MAX_DEPTH = 64;
const MAX_NODES = 100000;
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const REMOVE_VALUE = Symbol('remove_value');
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

type SanitizedJson = null | string | number | boolean | SanitizedJson[] | { [key: string]: SanitizedJson };
type Sanitized = SanitizedJson | typeof REMOVE_VALUE;

type CanonicalVector = {
  id: string;
  inputSpec: unknown;
  expectedCanonical?: string;
  expectedError?: ProtocolErrorCode;
};

type HashVector = {
  id: string;
  bundleSpec: unknown;
  expectedCanonical: string;
  expectedBundleHash: string;
};

class ProtocolError extends Error {
  code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode) {
    super(code);
    this.code = code;
    this.name = 'ProtocolError';
  }
}

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

function decodeSpec(value: unknown): unknown {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const entry of value) {
      out.push(decodeSpec(entry));
    }
    return out;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === '$st') {
    const marker = value.$st;
    if (marker === 'undefined') return undefined;
    if (marker === 'negzero') return -0;
    if (marker === 'nan') return Number.NaN;
    if (marker === 'infinity') return Number.POSITIVE_INFINITY;
    if (marker === 'minus_infinity') return Number.NEGATIVE_INFINITY;
  }

  const out: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    out[key] = decodeSpec(value[key]);
  }
  return out;
}

function sanitizeValue(value: unknown, depth: number, state: { nodes: number }): Sanitized {
  if (depth > MAX_DEPTH) {
    throw new ProtocolError('ERR_PAYLOAD_STRUCTURE_LIMIT');
  }

  state.nodes += 1;
  if (state.nodes > MAX_NODES) {
    throw new ProtocolError('ERR_PAYLOAD_STRUCTURE_LIMIT');
  }

  if (value === null) return null;

  if (typeof value === 'string') {
    if (value.includes('\u0000')) {
      throw new ProtocolError('ERR_PAYLOAD_CONTAINS_NULL_CHAR');
    }
    return value.normalize('NFC');
  }

  if (typeof value === 'boolean') return value;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ProtocolError('ERR_PAYLOAD_STRUCTURE_LIMIT');
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return REMOVE_VALUE;
  }

  if (typeof value === 'bigint') {
    throw new ProtocolError('ERR_PAYLOAD_STRUCTURE_LIMIT');
  }

  if (Array.isArray(value)) {
    const out: SanitizedJson[] = [];
    for (const entry of value) {
      const sanitized = sanitizeValue(entry, depth + 1, state);
      if (sanitized !== REMOVE_VALUE) {
        out.push(sanitized);
      }
    }
    return out;
  }

  if (!isPlainObject(value)) {
    throw new ProtocolError('ERR_PAYLOAD_STRUCTURE_LIMIT');
  }

  const out: { [key: string]: SanitizedJson } = Object.create(null);
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) {
      throw new ProtocolError('ERR_PAYLOAD_UNSAFE_KEY');
    }

    const sanitized = sanitizeValue(value[key], depth + 1, state);
    if (sanitized !== REMOVE_VALUE) {
      out[key] = sanitized;
    }
  }
  return out;
}

function canonicalStringify(value: SanitizedJson): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(',')}]`;
  }

  const keys = Object.keys(value).sort(compareStrings);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

function canonicalizeProtocolValue(value: unknown): string {
  const decoded = decodeSpec(value);
  const sanitized = sanitizeValue(decoded, 0, { nodes: 0 });
  if (sanitized === REMOVE_VALUE) {
    throw new ProtocolError('ERR_PAYLOAD_STRUCTURE_LIMIT');
  }

  const canonical = canonicalStringify(sanitized);
  if (Buffer.byteLength(canonical, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new ProtocolError('ERR_PAYLOAD_TOO_LARGE');
  }
  return canonical;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assert(condition: boolean): void {
  if (!condition) {
    throw new Error('assert_failed');
  }
}

function parseCanonicalVectors(raw: unknown): CanonicalVector[] {
  if (!isPlainObject(raw) || !Array.isArray(raw.vectors)) {
    throw new Error('invalid_golden');
  }
  return raw.vectors as CanonicalVector[];
}

function parseHashVectors(raw: unknown): HashVector[] {
  if (!isPlainObject(raw) || !Array.isArray(raw.vectors)) {
    throw new Error('invalid_golden');
  }
  return raw.vectors as HashVector[];
}

function loadJson(filePath: string): unknown {
  const raw = readFileSync(filePath, 'utf8');
  const withoutBom = raw.replace(/^\uFEFF/, '');
  return JSON.parse(withoutBom);
}

function runCanonicalizationTests(vectors: CanonicalVector[]): void {
  for (const vector of vectors) {
    if (vector.expectedError) {
      let caught: ProtocolErrorCode | null = null;
      try {
        void canonicalizeProtocolValue(vector.inputSpec);
      } catch (error) {
        if (error instanceof ProtocolError) {
          caught = error.code;
        }
      }
      assert(caught === vector.expectedError);
      continue;
    }

    const first = canonicalizeProtocolValue(vector.inputSpec);
    const second = canonicalizeProtocolValue(vector.inputSpec);
    assert(first === second);
    assert(first === vector.expectedCanonical);
  }
}

function runHashTests(vectors: HashVector[]): void {
  for (const vector of vectors) {
    const canonical = canonicalizeProtocolValue(vector.bundleSpec);
    assert(canonical === vector.expectedCanonical);

    const hashA = sha256Hex(canonical);
    const hashB = sha256Hex(canonicalizeProtocolValue(vector.bundleSpec));

    assert(hashA === hashB);
    assert(hashA === vector.expectedBundleHash);
  }
}

export function runProtocolSelftest(): void {
  const goldenDir = path.resolve(process.cwd(), 'src', 'selftest', 'golden');
  const canonicalVectors = parseCanonicalVectors(loadJson(path.join(goldenDir, 'canonicalization.json')));
  const hashVectors = parseHashVectors(loadJson(path.join(goldenDir, 'hash.json')));

  runCanonicalizationTests(canonicalVectors);
  runHashTests(hashVectors);
}

if (require.main === module) {
  try {
    runProtocolSelftest();
    process.stdout.write('PROTOCOL_SELFTEST_OK\n');
  } catch {
    process.stdout.write('PROTOCOL_SELFTEST_FAIL\n');
    process.exit(1);
  }
}






