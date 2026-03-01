import { createHash } from 'crypto';
import type { ArtifactBundleV1 } from './artifact-bundle-v1';

export type ArtifactStoreRecordV1 = {
  schema: 'artifact-store-record-1';
  identity: {
    packageId: string;
    revisionId: string | null;
    revisionHash: string | null;
  };
  bundleHash: string;
  artifactBundleV1: ArtifactBundleV1;
  createdAt: string | null;
  diagnostics: {
    notes: string[];
  };
  storeHash: string;
};

export type BuildArtifactStoreRecordV1Input = {
  identity: {
    packageId: string;
    revisionId?: string | null;
    revisionHash?: string | null;
  };
  bundleHash?: string | null;
  artifactBundleV1: unknown;
  createdAt?: string | null;
  diagnostics?: {
    notes?: string[];
  };
};

type StoreHashPayload = Omit<ArtifactStoreRecordV1, 'createdAt' | 'storeHash'>;

function makeStoreError(
  code: 'E_STORE_INVALID' | 'E_STORE_NON_JSON_SAFE' | 'E_STORE_HASH_MISMATCH',
  message: string
): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return null;
  throw makeStoreError('E_STORE_INVALID', 'Artifact store record input is invalid');
}

function normalizeRequiredString(value: unknown): string {
  if (typeof value === 'string') return value;
  throw makeStoreError('E_STORE_INVALID', 'Artifact store record input is invalid');
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw makeStoreError('E_STORE_INVALID', 'Artifact store record input is invalid');
    }
    normalized.push(entry);
  }
  return [...normalized].sort(compareStrings);
}

export function assertJsonSafe(value: unknown): void {
  if (value === null) return;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return;
  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw makeStoreError('E_STORE_NON_JSON_SAFE', 'Artifact store record contains non JSON-safe value');
    }
    return;
  }
  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
    throw makeStoreError('E_STORE_NON_JSON_SAFE', 'Artifact store record contains non JSON-safe value');
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      assertJsonSafe(entry);
    }
    return;
  }

  if (!isPlainObject(value)) {
    throw makeStoreError('E_STORE_NON_JSON_SAFE', 'Artifact store record contains non JSON-safe value');
  }

  const keys = Object.keys(value).sort(compareStrings);
  for (const key of keys) {
    assertJsonSafe(value[key]);
  }
}

export function stableStringify(value: unknown): string {
  assertJsonSafe(value);

  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareStrings);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function normalizeArtifactBundleV1(value: unknown): ArtifactBundleV1 {
  if (!isPlainObject(value) || value.schema !== 'artifact-bundle-1' || typeof value.bundleHash !== 'string') {
    throw makeStoreError('E_STORE_INVALID', 'Artifact store record input is invalid');
  }
  if (!isPlainObject(value.identity) || typeof value.identity.packageId !== 'string') {
    throw makeStoreError('E_STORE_INVALID', 'Artifact store record input is invalid');
  }
  assertJsonSafe(value);
  return value as ArtifactBundleV1;
}

function cloneArtifactBundleForStore(bundle: ArtifactBundleV1): ArtifactBundleV1 {
  const clone = JSON.parse(JSON.stringify(bundle)) as ArtifactBundleV1;
  clone.createdAt = null;
  if (clone.artifacts && clone.artifacts.lineageBindingV1) {
    clone.artifacts.lineageBindingV1.createdAt = null;
  }
  if (clone.artifacts && clone.artifacts.handoffRecordV1) {
    clone.artifacts.handoffRecordV1.createdAt = null;
    if (clone.artifacts.handoffRecordV1.lineageBindingV1) {
      clone.artifacts.handoffRecordV1.lineageBindingV1.createdAt = null;
    }
  }
  return clone;
}

function buildCanonicalRecord(input: BuildArtifactStoreRecordV1Input): Omit<ArtifactStoreRecordV1, 'storeHash'> {
  if (!isPlainObject(input) || !isPlainObject(input.identity)) {
    throw makeStoreError('E_STORE_INVALID', 'Artifact store record input is invalid');
  }

  assertJsonSafe(input);

  if (typeof input.identity.packageId !== 'string') {
    throw makeStoreError('E_STORE_INVALID', 'Artifact store record input is invalid');
  }

  const artifactBundleV1 = normalizeArtifactBundleV1(input.artifactBundleV1);
  const bundleHash = typeof input.bundleHash === 'string' ? input.bundleHash : artifactBundleV1.bundleHash;

  return {
    schema: 'artifact-store-record-1',
    identity: {
      packageId: input.identity.packageId,
      revisionId: normalizeNullableString(input.identity.revisionId),
      revisionHash: normalizeNullableString(input.identity.revisionHash),
    },
    bundleHash,
    artifactBundleV1,
    createdAt: normalizeNullableString(input.createdAt),
    diagnostics: {
      notes: normalizeStringArray(input.diagnostics?.notes),
    },
  };
}

function canonicalizeRecordForHash(record: Omit<ArtifactStoreRecordV1, 'storeHash'> | ArtifactStoreRecordV1): StoreHashPayload {
  return {
    schema: 'artifact-store-record-1',
    identity: {
      packageId: record.identity.packageId,
      revisionId: record.identity.revisionId,
      revisionHash: record.identity.revisionHash,
    },
    bundleHash: record.bundleHash,
    artifactBundleV1: cloneArtifactBundleForStore(record.artifactBundleV1),
    diagnostics: {
      notes: [...record.diagnostics.notes],
    },
  };
}

function normalizeStoreRecord(record: unknown): ArtifactStoreRecordV1 {
  if (!isPlainObject(record) || record.schema !== 'artifact-store-record-1' || typeof record.storeHash !== 'string') {
    throw makeStoreError('E_STORE_INVALID', 'Artifact store record input is invalid');
  }
  if (!isPlainObject(record.identity) || typeof record.identity.packageId !== 'string') {
    throw makeStoreError('E_STORE_INVALID', 'Artifact store record input is invalid');
  }

  const normalized: ArtifactStoreRecordV1 = {
    schema: 'artifact-store-record-1',
    identity: {
      packageId: record.identity.packageId,
      revisionId: normalizeNullableString(record.identity.revisionId),
      revisionHash: normalizeNullableString(record.identity.revisionHash),
    },
    bundleHash: normalizeRequiredString(record.bundleHash),
    artifactBundleV1: normalizeArtifactBundleV1(record.artifactBundleV1),
    createdAt: normalizeNullableString(record.createdAt),
    diagnostics: {
      notes: isPlainObject(record.diagnostics) ? normalizeStringArray(record.diagnostics.notes) : [],
    },
    storeHash: record.storeHash,
  };

  assertJsonSafe(normalized);
  return normalized;
}

export function buildArtifactStoreRecordV1(input: BuildArtifactStoreRecordV1Input): ArtifactStoreRecordV1 {
  const recordWithoutHash = buildCanonicalRecord(input);
  const storeHash = sha256Hex(stableStringify(canonicalizeRecordForHash(recordWithoutHash)));
  const record: ArtifactStoreRecordV1 = {
    ...recordWithoutHash,
    storeHash,
  };
  assertJsonSafe(record);
  return record;
}

export function recomputeArtifactStoreRecordV1Hash(record: ArtifactStoreRecordV1): string {
  const normalized = normalizeStoreRecord(record);
  return sha256Hex(stableStringify(canonicalizeRecordForHash(normalized)));
}

export function verifyArtifactStoreRecordV1(
  record: ArtifactStoreRecordV1
): { ok: true; recomputedHash: string; matches: boolean } {
  const normalized = normalizeStoreRecord(record);
  const recomputedHash = sha256Hex(stableStringify(canonicalizeRecordForHash(normalized)));
  return {
    ok: true,
    recomputedHash,
    matches: recomputedHash === normalized.storeHash,
  };
}

export function verifyArtifactStoreRecordV1OrThrow(record: ArtifactStoreRecordV1): void {
  const verification = verifyArtifactStoreRecordV1(record);
  if (!verification.matches) {
    throw makeStoreError('E_STORE_HASH_MISMATCH', 'Artifact store record hash mismatch');
  }
}



