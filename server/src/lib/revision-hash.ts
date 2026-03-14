import { createHash } from 'crypto';

export type RevisionArtifactReference = {
  bundleHash: string;
  role: string;
};

export type RevisionMetadata = {
  author: string;
  message: string;
  createdBy: string;
  timestamp: string;
  source: 'human' | 'ai' | 'migration' | 'system';
  tags?: string[] | null;
};

export type ComputeRevisionHashInput = {
  packageId: string;
  parentRevisionHash?: string | null;
  artifacts: RevisionArtifactReference[];
  metadata: RevisionMetadata;
};

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalizeValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Revision hash input is invalid');
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    for (const item of value) {
      out.push(canonicalizeValue(item));
    }
    return out;
  }

  if (!isPlainObject(value)) {
    throw new Error('Revision hash input is invalid');
  }

  const out: { [key: string]: JsonValue } = Object.create(null);
  const keys = Object.keys(value).sort(compareStrings);
  for (const key of keys) {
    const child = value[key];
    if (typeof child === 'undefined') {
      continue;
    }
    out[key] = canonicalizeValue(child);
  }
  return out;
}

function canonicalStringify(value: JsonValue): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(',')}]`;
  }

  const keys = Object.keys(value).sort(compareStrings);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

function normalizeArtifacts(artifacts: RevisionArtifactReference[]): RevisionArtifactReference[] {
  const out = artifacts.map((artifact) => ({
    bundleHash: artifact.bundleHash,
    role: artifact.role,
  }));

  out.sort((a, b) => {
    const bundleHashOrder = compareStrings(a.bundleHash, b.bundleHash);
    if (bundleHashOrder !== 0) {
      return bundleHashOrder;
    }
    return compareStrings(a.role, b.role);
  });

  return out;
}

function normalizeMetadata(metadata: RevisionMetadata): RevisionMetadata {
  const tags = Array.isArray(metadata.tags)
    ? [...metadata.tags].sort(compareStrings)
    : metadata.tags === null
      ? null
      : undefined;

  return {
    author: metadata.author,
    message: metadata.message,
    createdBy: metadata.createdBy,
    timestamp: metadata.timestamp,
    source: metadata.source,
    ...(typeof tags === 'undefined' ? {} : { tags }),
  };
}

export function computeRevisionHash(input: ComputeRevisionHashInput): string {
  const hashPayload = {
    schema: 'revision.node.v1',
    packageId: input.packageId,
    parentRevisionHash: input.parentRevisionHash ?? null,
    artifacts: normalizeArtifacts(input.artifacts),
    metadata: normalizeMetadata(input.metadata),
  };

  const canonicalPayload = canonicalizeValue(hashPayload);
  const canonicalJson = canonicalStringify(canonicalPayload);
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}
