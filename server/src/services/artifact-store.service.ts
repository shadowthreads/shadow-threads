import { Prisma } from '@prisma/client';
import { canonicalizeJson, computeBundleHash } from '../lib/artifact-hash';
import { IdentityGuardError, assertHashMatch } from '../lib/identity-guards';
import { JsonSanitizeError, sanitizeJsonPayload } from '../lib/json-sanitize';
import { prisma } from '../utils';
import {
  buildArtifactStoreRecordV1,
  verifyArtifactStoreRecordV1,
  type ArtifactStoreRecordV1,
  type BuildArtifactStoreRecordV1Input,
} from './artifact-store-v1';

const BUNDLE_HASH_PATTERN = /^[0-9a-f]{64}$/;
const ARTIFACT_VALIDATION_MESSAGE = 'Artifact input is invalid';
const ARTIFACT_CONFLICT_MESSAGE = 'Artifact already exists with different payload';
const ARTIFACT_PAYLOAD_INVALID_MESSAGE = 'payload contains non-JSON-safe value';
const ARTIFACT_HASH_MISMATCH_MESSAGE = 'Artifact hash mismatch';

export class ArtifactValidationError extends Error {
  code = 'E_ARTIFACT_VALIDATION';

  constructor(message = ARTIFACT_VALIDATION_MESSAGE) {
    super(message);
    this.name = 'ArtifactValidationError';
  }
}

export class ArtifactConflictError extends Error {
  code = 'E_ARTIFACT_CONFLICT';

  constructor(message = ARTIFACT_CONFLICT_MESSAGE) {
    super(message);
    this.name = 'ArtifactConflictError';
  }
}

export class ArtifactHashMismatchError extends Error {
  code = 'ERR_ARTIFACT_HASH_MISMATCH';

  constructor(message = ARTIFACT_HASH_MISMATCH_MESSAGE) {
    super(message);
    this.name = 'ArtifactHashMismatchError';
  }
}

export type ArtifactStoreIdentity = {
  packageId: string;
  revisionId: string | null;
  revisionHash: string | null;
};

export type StoreArtifactBundleInput = {
  schema: string;
  identity: {
    packageId: string;
    revisionId?: string | null;
    revisionHash?: string | null;
  };
  payload: unknown;
  bundleHash?: string;
  createdAt?: string | null;
};

export type ArtifactStoreRecordDTO = {
  id: string;
  schema: string;
  identity: ArtifactStoreIdentity;
  bundleHash: string;
  payload: unknown;
  createdAt: string;
};

export type LoadArtifactBundleQuery = {
  packageId: string;
  bundleHash: string;
};

export type VerifyArtifactBundleInput = {
  schema: string;
  identity: {
    packageId: string;
    revisionId?: string | null;
    revisionHash?: string | null;
  };
  payload: unknown;
  bundleHash: string;
};

export type SaveBundleV1Input = {
  artifactBundleV1: unknown;
  createdAt?: string | null;
  notes?: string[];
};

export type GetBundleV1Query = {
  packageId: string;
  bundleHash: string;
};

type ArtifactStorePrismaRecord = {
  id: string;
  schema: string;
  packageId: string;
  revisionId: string | null;
  revisionHash: string | null;
  bundleHash: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeRequiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ArtifactValidationError();
  }
  return value;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return null;
  throw new ArtifactValidationError();
}

function normalizeIdentity(identity: StoreArtifactBundleInput['identity']): ArtifactStoreIdentity {
  if (!identity || typeof identity !== 'object') {
    throw new ArtifactValidationError();
  }

  return {
    packageId: normalizeRequiredString(identity.packageId),
    revisionId: normalizeNullableString(identity.revisionId),
    revisionHash: normalizeNullableString(identity.revisionHash),
  };
}

function normalizeBundleHash(bundleHash: string): string {
  const normalized = bundleHash.toLowerCase();
  if (!BUNDLE_HASH_PATTERN.test(normalized)) {
    throw new ArtifactValidationError();
  }
  return normalized;
}

function normalizeCreatedAtForWrite(createdAt: string | null | undefined): Date | undefined {
  if (createdAt === null || createdAt === undefined) {
    return undefined;
  }
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new ArtifactValidationError();
  }
  return parsed;
}

function sanitizePayloadOrThrow(payload: unknown): unknown {
  try {
    return sanitizeJsonPayload(payload);
  } catch (error) {
    if (error instanceof JsonSanitizeError) {
      throw new ArtifactValidationError(ARTIFACT_PAYLOAD_INVALID_MESSAGE);
    }
    throw new ArtifactValidationError(ARTIFACT_PAYLOAD_INVALID_MESSAGE);
  }
}

function toPrismaJsonValue(payload: unknown): { sanitizedPayload: unknown; canonical: string; jsonValue: Prisma.InputJsonValue } {
  const sanitizedPayload = sanitizePayloadOrThrow(payload);
  const canonical = canonicalizeJson(sanitizedPayload);
  const normalizedPayload = JSON.parse(canonical) as Prisma.InputJsonValue;
  return {
    sanitizedPayload,
    canonical,
    jsonValue: normalizedPayload,
  };
}

function toDto(record: ArtifactStorePrismaRecord): ArtifactStoreRecordDTO {
  return {
    id: record.id,
    schema: record.schema,
    identity: {
      packageId: record.packageId,
      revisionId: record.revisionId,
      revisionHash: record.revisionHash,
    },
    bundleHash: record.bundleHash,
    payload: record.payload,
    createdAt: record.createdAt.toISOString(),
  };
}

function extractArtifactBundleIdentity(value: unknown): ArtifactStoreIdentity {
  if (!isPlainObject(value) || !isPlainObject(value.identity)) {
    throw new ArtifactValidationError();
  }

  return {
    packageId: normalizeRequiredString(value.identity.packageId),
    revisionId: normalizeNullableString(value.identity.revisionId),
    revisionHash: normalizeNullableString(value.identity.revisionHash),
  };
}

function extractArtifactBundleSchema(value: unknown): string {
  if (!isPlainObject(value)) {
    throw new ArtifactValidationError();
  }

  return normalizeRequiredString(value.schema);
}

function extractArtifactBundleHash(value: unknown): string | undefined {
  if (!isPlainObject(value) || typeof value.bundleHash !== 'string') {
    return undefined;
  }
  return normalizeBundleHash(value.bundleHash);
}

function extractNotes(notes: string[] | undefined): string[] {
  if (!Array.isArray(notes)) return [];
  return notes.filter((note) => typeof note === 'string');
}

export function recomputeBundleHashFromRecord(record: {
  schema: string;
  packageId: string;
  revisionId?: string | null;
  revisionHash?: string | null;
  payload: unknown;
}): string {
  const sanitizedPayload = sanitizePayloadOrThrow(record.payload);
  return computeBundleHash({
    schema: record.schema,
    packageId: record.packageId,
    revisionId: record.revisionId ?? null,
    revisionHash: record.revisionHash ?? null,
    payload: sanitizedPayload,
  });
}

export class ArtifactStoreService {
  async storeArtifactBundle(input: StoreArtifactBundleInput): Promise<ArtifactStoreRecordDTO> {
    const schema = normalizeRequiredString(input.schema);
    const identity = normalizeIdentity(input.identity);
    const payload = toPrismaJsonValue(input.payload);
    const computedBundleHash = computeBundleHash({
      schema,
      packageId: identity.packageId,
      revisionId: identity.revisionId,
      revisionHash: identity.revisionHash,
      payload: payload.sanitizedPayload,
    });
    let bundleHash = computedBundleHash;
    if (input.bundleHash) {
      try {
        bundleHash = assertHashMatch(normalizeBundleHash(input.bundleHash), computedBundleHash);
      } catch (error) {
        if (error instanceof IdentityGuardError && error.code === 'ERR_ARTIFACT_HASH_MISMATCH') {
          throw new ArtifactHashMismatchError();
        }
        throw error;
      }
    }

    const where = {
      packageId_bundleHash: {
        packageId: identity.packageId,
        bundleHash,
      },
    };

    const existing = await prisma.artifactStoreRecord.findUnique({ where });
    if (existing) {
      const existingCanonical = canonicalizeJson(existing.payload);
      if (existingCanonical !== payload.canonical) {
        throw new ArtifactConflictError();
      }
      return toDto(existing);
    }

    const createdAt = normalizeCreatedAtForWrite(input.createdAt);
    const persisted = await prisma.artifactStoreRecord.upsert({
      where,
      create: {
        schema,
        packageId: identity.packageId,
        revisionId: identity.revisionId,
        revisionHash: identity.revisionHash,
        bundleHash,
        payload: payload.jsonValue,
        ...(createdAt ? { createdAt } : {}),
      },
      update: {},
    });

    const persistedCanonical = canonicalizeJson(persisted.payload);
    if (persistedCanonical !== payload.canonical) {
      throw new ArtifactConflictError();
    }

    return toDto(persisted);
  }

  async loadArtifactBundle(where: LoadArtifactBundleQuery): Promise<ArtifactStoreRecordDTO | null> {
    const packageId = normalizeRequiredString(where.packageId);
    const bundleHash = normalizeBundleHash(where.bundleHash);

    const found = await prisma.artifactStoreRecord.findUnique({
      where: {
        packageId_bundleHash: {
          packageId,
          bundleHash,
        },
      },
    });

    return found ? toDto(found) : null;
  }

  verifyArtifactBundle(input: VerifyArtifactBundleInput): { ok: true } | { ok: false; reason: string } {
    try {
      const schema = normalizeRequiredString(input.schema);
      const identity = normalizeIdentity(input.identity);
      const normalizedHash = normalizeBundleHash(input.bundleHash);
      const sanitizedPayload = sanitizePayloadOrThrow(input.payload);
      const recomputedHash = computeBundleHash({
        schema,
        packageId: identity.packageId,
        revisionId: identity.revisionId,
        revisionHash: identity.revisionHash,
        payload: sanitizedPayload,
      });

      if (recomputedHash !== normalizedHash) {
        return { ok: false, reason: 'bundle_hash_mismatch' };
      }

      return { ok: true };
    } catch (error) {
      if (error instanceof ArtifactValidationError) {
        return { ok: false, reason: 'invalid_artifact_input' };
      }
      return { ok: false, reason: 'invalid_artifact_input' };
    }
  }

  async saveBundleV1(input: SaveBundleV1Input): Promise<{ artifactStoreRecordV1: ArtifactStoreRecordV1 }> {
    const identity = extractArtifactBundleIdentity(input.artifactBundleV1);
    const schema = extractArtifactBundleSchema(input.artifactBundleV1);
    const bundleHash = extractArtifactBundleHash(input.artifactBundleV1);

    const stored = await this.storeArtifactBundle({
      schema,
      identity,
      payload: input.artifactBundleV1,
      bundleHash,
      createdAt: input.createdAt ?? null,
    });

    const artifactStoreRecordV1 = buildArtifactStoreRecordV1({
      identity: {
        packageId: stored.identity.packageId,
        revisionId: stored.identity.revisionId,
        revisionHash: stored.identity.revisionHash,
      },
      bundleHash: stored.bundleHash,
      artifactBundleV1: stored.payload,
      createdAt: stored.createdAt,
      diagnostics: {
        notes: extractNotes(input.notes),
      },
    });

    return { artifactStoreRecordV1 };
  }

  async getBundleV1(query: GetBundleV1Query): Promise<{ artifactStoreRecordV1: ArtifactStoreRecordV1 | null }> {
    const loaded = await this.loadArtifactBundle(query);
    if (!loaded) {
      return { artifactStoreRecordV1: null };
    }

    const artifactStoreRecordV1 = buildArtifactStoreRecordV1({
      identity: {
        packageId: loaded.identity.packageId,
        revisionId: loaded.identity.revisionId,
        revisionHash: loaded.identity.revisionHash,
      },
      bundleHash: loaded.bundleHash,
      artifactBundleV1: loaded.payload,
      createdAt: loaded.createdAt,
      diagnostics: {
        notes: [],
      },
    });

    return { artifactStoreRecordV1 };
  }

  async verifyStoredBundleV1(
    query: GetBundleV1Query
  ): Promise<{ ok: true; recomputedHash: string; matches: boolean } | null> {
    const found = await this.getBundleV1(query);
    if (!found.artifactStoreRecordV1) {
      return null;
    }
    return verifyArtifactStoreRecordV1(found.artifactStoreRecordV1);
  }
}

export function buildArtifactStoreRecordV1ForPersistence(
  input: BuildArtifactStoreRecordV1Input
): ArtifactStoreRecordV1 {
  return buildArtifactStoreRecordV1(input);
}
