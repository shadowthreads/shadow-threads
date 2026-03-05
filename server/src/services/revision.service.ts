import type { PrismaClient } from '@prisma/client';
import {
  computeRevisionHash,
  type RevisionArtifactReference,
  type RevisionMetadata,
} from '../lib/revision-hash';

const REVISION_HASH_PATTERN = /^[0-9a-f]{64}$/;
const BUNDLE_HASH_PATTERN = /^[0-9a-f]{64}$/;

const ERR_REVISION_INVALID_INPUT = 'ERR_REVISION_INVALID_INPUT';
const ERR_REVISION_PARENT_NOT_FOUND = 'ERR_REVISION_PARENT_NOT_FOUND';
const ERR_ARTIFACT_NOT_FOUND = 'ERR_ARTIFACT_NOT_FOUND';

const MESSAGE_REVISION_INVALID_INPUT = 'Revision input is invalid';
const MESSAGE_REVISION_PARENT_NOT_FOUND = 'Revision parent not found';
const MESSAGE_ARTIFACT_NOT_FOUND = 'Artifact not found';

export type RevisionSource = 'human' | 'ai' | 'migration' | 'system';

export type CreateRevisionInput = {
  packageId: string;
  parentRevisionHash?: string | null;
  artifacts: RevisionArtifactReference[];
  metadata: {
    author: string;
    message: string;
    createdBy: string;
    timestamp: string;
    source: RevisionSource;
    tags?: string[];
  };
};

export type GetRevisionQuery = {
  revisionHash: string;
};

export type ListRevisionsQuery = {
  packageId: string;
  limit?: number;
};

export type RevisionRecord = {
  revisionHash: string;
  packageId: string;
  parentRevisionHash: string | null;
  author: string;
  message: string;
  createdBy: string;
  timestamp: string;
  source: string;
  metadata: unknown;
  createdAt: string;
  artifacts: RevisionArtifactReference[];
};

type StoredRevisionRecord = {
  revisionHash: string;
  packageId: string;
  parentRevisionHash: string | null;
  author: string;
  message: string;
  createdBy: string;
  timestamp: Date;
  source: string;
  metadata: unknown;
  createdAt: Date;
  artifacts: RevisionArtifactReference[];
};

export type RevisionStorageAdapter = {
  findRevisionByHash(revisionHash: string): Promise<StoredRevisionRecord | null>;
  createRevision(input: {
    revisionHash: string;
    packageId: string;
    parentRevisionHash: string | null;
    metadata: RevisionMetadata;
    artifacts: RevisionArtifactReference[];
  }): Promise<StoredRevisionRecord>;
  listRevisions(packageId: string, limit: number): Promise<StoredRevisionRecord[]>;
  artifactExists(packageId: string, bundleHash: string): Promise<boolean>;
};

export class RevisionServiceError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'RevisionServiceError';
  }
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeRequiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RevisionServiceError(ERR_REVISION_INVALID_INPUT, MESSAGE_REVISION_INVALID_INPUT);
  }
  return value;
}

function normalizeNullableHash(value: unknown): string | null {
  if (value === null || typeof value === 'undefined') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new RevisionServiceError(ERR_REVISION_INVALID_INPUT, MESSAGE_REVISION_INVALID_INPUT);
  }

  const normalized = value.toLowerCase();
  if (!REVISION_HASH_PATTERN.test(normalized)) {
    throw new RevisionServiceError(ERR_REVISION_INVALID_INPUT, MESSAGE_REVISION_INVALID_INPUT);
  }
  return normalized;
}

function normalizeBundleHash(value: unknown): string {
  if (typeof value !== 'string') {
    throw new RevisionServiceError(ERR_REVISION_INVALID_INPUT, MESSAGE_REVISION_INVALID_INPUT);
  }
  const normalized = value.toLowerCase();
  if (!BUNDLE_HASH_PATTERN.test(normalized)) {
    throw new RevisionServiceError(ERR_REVISION_INVALID_INPUT, MESSAGE_REVISION_INVALID_INPUT);
  }
  return normalized;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RevisionServiceError(ERR_REVISION_INVALID_INPUT, MESSAGE_REVISION_INVALID_INPUT);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new RevisionServiceError(ERR_REVISION_INVALID_INPUT, MESSAGE_REVISION_INVALID_INPUT);
  }

  return parsed.toISOString();
}

function normalizeArtifacts(artifacts: unknown): RevisionArtifactReference[] {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new RevisionServiceError(ERR_REVISION_INVALID_INPUT, MESSAGE_REVISION_INVALID_INPUT);
  }

  const out: RevisionArtifactReference[] = [];
  for (const item of artifacts) {
    if (!item || typeof item !== 'object') {
      throw new RevisionServiceError(ERR_REVISION_INVALID_INPUT, MESSAGE_REVISION_INVALID_INPUT);
    }

    const entry = item as { bundleHash?: unknown; role?: unknown };
    out.push({
      bundleHash: normalizeBundleHash(entry.bundleHash),
      role: normalizeRequiredString(entry.role),
    });
  }

  out.sort((a, b) => {
    const bundleHashOrder = compareStrings(a.bundleHash, b.bundleHash);
    if (bundleHashOrder !== 0) {
      return bundleHashOrder;
    }
    return compareStrings(a.role, b.role);
  });

  return out;
}

function normalizeMetadata(metadata: unknown): RevisionMetadata {
  if (!metadata || typeof metadata !== 'object') {
    throw new RevisionServiceError(ERR_REVISION_INVALID_INPUT, MESSAGE_REVISION_INVALID_INPUT);
  }

  const value = metadata as {
    author?: unknown;
    message?: unknown;
    createdBy?: unknown;
    timestamp?: unknown;
    source?: unknown;
    tags?: unknown;
  };

  if (
    value.source !== 'human' &&
    value.source !== 'ai' &&
    value.source !== 'migration' &&
    value.source !== 'system'
  ) {
    throw new RevisionServiceError(ERR_REVISION_INVALID_INPUT, MESSAGE_REVISION_INVALID_INPUT);
  }

  let tags: string[] | undefined;
  if (typeof value.tags !== 'undefined') {
    if (!Array.isArray(value.tags)) {
      throw new RevisionServiceError(ERR_REVISION_INVALID_INPUT, MESSAGE_REVISION_INVALID_INPUT);
    }
    tags = value.tags.map((tag) => normalizeRequiredString(tag)).sort(compareStrings);
  }

  return {
    author: normalizeRequiredString(value.author),
    message: normalizeRequiredString(value.message),
    createdBy: normalizeRequiredString(value.createdBy),
    timestamp: normalizeTimestamp(value.timestamp),
    source: value.source,
    ...(tags ? { tags } : {}),
  };
}

function normalizeLimit(value: unknown): number {
  if (typeof value === 'undefined') {
    return 100;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 500) {
    throw new RevisionServiceError(ERR_REVISION_INVALID_INPUT, MESSAGE_REVISION_INVALID_INPUT);
  }
  return value;
}

function toRevisionRecord(node: StoredRevisionRecord): RevisionRecord {
  const artifacts = node.artifacts
    .map((artifact) => ({
      bundleHash: artifact.bundleHash,
      role: artifact.role,
    }))
    .sort((a, b) => {
      const bundleHashOrder = compareStrings(a.bundleHash, b.bundleHash);
      if (bundleHashOrder !== 0) {
        return bundleHashOrder;
      }
      return compareStrings(a.role, b.role);
    });

  return {
    revisionHash: node.revisionHash,
    packageId: node.packageId,
    parentRevisionHash: node.parentRevisionHash,
    author: node.author,
    message: node.message,
    createdBy: node.createdBy,
    timestamp: node.timestamp.toISOString(),
    source: node.source,
    metadata: node.metadata,
    createdAt: node.createdAt.toISOString(),
    artifacts,
  };
}

function toStoredRevisionRecordFromPrisma(node: {
  revisionHash: string;
  packageId: string;
  parentRevisionHash: string | null;
  author: string;
  message: string;
  createdBy: string;
  timestamp: Date;
  source: string;
  metadata: unknown;
  createdAt: Date;
  artifacts: { bundleHash: string; role: string }[];
}): StoredRevisionRecord {
  return {
    revisionHash: node.revisionHash,
    packageId: node.packageId,
    parentRevisionHash: node.parentRevisionHash,
    author: node.author,
    message: node.message,
    createdBy: node.createdBy,
    timestamp: node.timestamp,
    source: node.source,
    metadata: node.metadata,
    createdAt: node.createdAt,
    artifacts: node.artifacts.map((artifact) => ({
      bundleHash: artifact.bundleHash,
      role: artifact.role,
    })),
  };
}

function createDefaultRevisionStorageAdapter(): RevisionStorageAdapter {
  const { prisma } = require('../utils') as { prisma: PrismaClient };

  return {
    async findRevisionByHash(revisionHash: string): Promise<StoredRevisionRecord | null> {
      const found = await prisma.revisionNode.findUnique({
        where: { revisionHash },
        include: { artifacts: true },
      });
      return found ? toStoredRevisionRecordFromPrisma(found) : null;
    },

    async createRevision(input): Promise<StoredRevisionRecord> {
      const created = await prisma.$transaction(async (tx) => {
        const node = await tx.revisionNode.create({
          data: {
            revisionHash: input.revisionHash,
            packageId: input.packageId,
            parentRevisionHash: input.parentRevisionHash,
            author: input.metadata.author,
            message: input.metadata.message,
            createdBy: input.metadata.createdBy,
            timestamp: input.metadata.timestamp,
            source: input.metadata.source,
            metadata: input.metadata,
          },
        });

        await tx.revisionArtifact.createMany({
          data: input.artifacts.map((artifact) => ({
            revisionHash: input.revisionHash,
            bundleHash: artifact.bundleHash,
            role: artifact.role,
          })),
        });

        return tx.revisionNode.findUniqueOrThrow({
          where: { revisionHash: node.revisionHash },
          include: { artifacts: true },
        });
      });

      return toStoredRevisionRecordFromPrisma(created);
    },

    async listRevisions(packageId: string, limit: number): Promise<StoredRevisionRecord[]> {
      const rows = await prisma.revisionNode.findMany({
        where: { packageId },
        take: limit,
        orderBy: [{ timestamp: 'asc' }, { revisionHash: 'asc' }],
        include: { artifacts: true },
      });

      return rows.map((row) => toStoredRevisionRecordFromPrisma(row));
    },

    async artifactExists(packageId: string, bundleHash: string): Promise<boolean> {
      const found = await prisma.artifactStoreRecord.findUnique({
        where: {
          packageId_bundleHash: {
            packageId,
            bundleHash,
          },
        },
        select: { id: true },
      });

      return Boolean(found);
    },
  };
}

export class RevisionService {
  private readonly storage: RevisionStorageAdapter;

  constructor(storage?: RevisionStorageAdapter) {
    this.storage = storage ?? createDefaultRevisionStorageAdapter();
  }

  async createRevision(input: CreateRevisionInput): Promise<RevisionRecord> {
    const packageId = normalizeRequiredString(input.packageId);
    const parentRevisionHash = normalizeNullableHash(input.parentRevisionHash);
    const artifacts = normalizeArtifacts(input.artifacts);
    const metadata = normalizeMetadata(input.metadata);

    if (parentRevisionHash) {
      const parent = await this.storage.findRevisionByHash(parentRevisionHash);
      if (!parent) {
        throw new RevisionServiceError(ERR_REVISION_PARENT_NOT_FOUND, MESSAGE_REVISION_PARENT_NOT_FOUND);
      }
    }

    for (const artifact of artifacts) {
      const exists = await this.storage.artifactExists(packageId, artifact.bundleHash);
      if (!exists) {
        throw new RevisionServiceError(ERR_ARTIFACT_NOT_FOUND, MESSAGE_ARTIFACT_NOT_FOUND);
      }
    }

    const revisionHash = computeRevisionHash({
      packageId,
      parentRevisionHash,
      artifacts,
      metadata,
    });

    const existing = await this.storage.findRevisionByHash(revisionHash);
    if (existing) {
      return toRevisionRecord(existing);
    }

    const created = await this.storage.createRevision({
      revisionHash,
      packageId,
      parentRevisionHash,
      metadata,
      artifacts,
    });

    return toRevisionRecord(created);
  }

  async getRevision(query: GetRevisionQuery): Promise<RevisionRecord | null> {
    const revisionHash = normalizeNullableHash(query.revisionHash);
    if (!revisionHash) {
      throw new RevisionServiceError(ERR_REVISION_INVALID_INPUT, MESSAGE_REVISION_INVALID_INPUT);
    }

    const found = await this.storage.findRevisionByHash(revisionHash);
    return found ? toRevisionRecord(found) : null;
  }

  async listRevisions(query: ListRevisionsQuery): Promise<RevisionRecord[]> {
    const packageId = normalizeRequiredString(query.packageId);
    const limit = normalizeLimit(query.limit);

    const rows = await this.storage.listRevisions(packageId, limit);
    return rows.map((row) => toRevisionRecord(row));
  }
}

export const REVISION_ERROR_CODES = {
  ERR_REVISION_INVALID_INPUT,
  ERR_REVISION_PARENT_NOT_FOUND,
  ERR_ARTIFACT_NOT_FOUND,
} as const;


