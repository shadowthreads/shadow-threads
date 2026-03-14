import { mkdirSync } from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import { computeBundleHash } from '../lib/artifact-hash';
import { computeRevisionHash, type RevisionArtifactReference, type RevisionMetadata } from '../lib/revision-hash';
import {
  REVISION_CARRIER_SCHEMA,
  buildManifest,
  buildMetadata,
  normalizeArtifactBundle,
  parseArtifactsJsonl,
  readMigrationPackageZip,
  stringifyArtifactsJsonl,
  writeMigrationPackageZip,
  type ArtifactBundleLike,
  type ArtifactReference,
  type MigrationManifestV1,
  type MigrationMetadataV1,
} from '../lib/migration-package';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ERR_MIGRATION_INVALID_INPUT = 'ERR_MIGRATION_INVALID_INPUT';
const ERR_MIGRATION_CLOSURE_INCOMPLETE = 'ERR_MIGRATION_CLOSURE_INCOMPLETE';
const ERR_MIGRATION_VERIFY_MISMATCH = 'ERR_MIGRATION_VERIFY_MISMATCH';
const ERR_MIGRATION_IDENTITY_MISMATCH = 'ERR_MIGRATION_IDENTITY_MISMATCH';

const MESSAGE_MIGRATION_INVALID_INPUT = 'Migration package input is invalid';
const MESSAGE_MIGRATION_CLOSURE_INCOMPLETE = 'Migration closure is incomplete';
const MESSAGE_MIGRATION_VERIFY_MISMATCH = 'Migration package verification failed';
const MESSAGE_MIGRATION_IDENTITY_MISMATCH = 'Migration package identity mismatch';

export type MigrationRevisionRecord = {
  revisionHash: string;
  packageId: string;
  parentRevisionHash: string | null;
  artifacts: RevisionArtifactReference[];
  metadata: RevisionMetadata;
};

export type ClosureResult = {
  rootRevisionHash: string;
  revisions: MigrationRevisionRecord[];
  artifacts: Array<{
    bundleHash: string;
    bundle: ArtifactBundleLike;
  }>;
};

export type VerifyResult = {
  ok: true;
  rootRevisionHash: string;
  artifactCount: number;
  revisionCount: number;
  matches: true;
};

export type ImportResult = {
  ok: true;
  rootRevisionHash: string;
  artifactCount: number;
  revisionCount: number;
};

type StoredRevisionNode = {
  revisionHash: string;
  packageId: string;
  parentRevisionHash: string | null;
  artifacts: RevisionArtifactReference[];
  metadata: RevisionMetadata;
};

type MigrationStorageAdapter = {
  findRevisionByHash(revisionHash: string): Promise<StoredRevisionNode | null>;
  findArtifactByPackageAndHash(packageId: string, bundleHash: string): Promise<ArtifactBundleLike | null>;
  findArtifactByHash(bundleHash: string): Promise<ArtifactBundleLike | null>;
  storeArtifactBundle(bundle: ArtifactBundleLike): Promise<void>;
  createRevision(revision: MigrationRevisionRecord): Promise<{ revisionHash: string }>;
};

export class MigrationServiceError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'MigrationServiceError';
  }
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeRequiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new MigrationServiceError(ERR_MIGRATION_INVALID_INPUT, MESSAGE_MIGRATION_INVALID_INPUT);
  }
  return value;
}

function normalizeHash(value: unknown): string {
  if (typeof value !== 'string') {
    throw new MigrationServiceError(ERR_MIGRATION_INVALID_INPUT, MESSAGE_MIGRATION_INVALID_INPUT);
  }
  const normalized = value.toLowerCase();
  if (!HASH_PATTERN.test(normalized)) {
    throw new MigrationServiceError(ERR_MIGRATION_INVALID_INPUT, MESSAGE_MIGRATION_INVALID_INPUT);
  }
  return normalized;
}

function normalizeMetadata(value: unknown): RevisionMetadata {
  if (!value || typeof value !== 'object') {
    throw new MigrationServiceError(ERR_MIGRATION_INVALID_INPUT, MESSAGE_MIGRATION_INVALID_INPUT);
  }

  const metadata = value as {
    author?: unknown;
    message?: unknown;
    createdBy?: unknown;
    timestamp?: unknown;
    source?: unknown;
    tags?: unknown;
  };

  if (
    metadata.source !== 'human' &&
    metadata.source !== 'ai' &&
    metadata.source !== 'migration' &&
    metadata.source !== 'system'
  ) {
    throw new MigrationServiceError(ERR_MIGRATION_INVALID_INPUT, MESSAGE_MIGRATION_INVALID_INPUT);
  }

  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.map((tag) => normalizeRequiredString(tag)).sort(compareStrings)
    : [];

  const timestamp = normalizeRequiredString(metadata.timestamp);
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new MigrationServiceError(ERR_MIGRATION_INVALID_INPUT, MESSAGE_MIGRATION_INVALID_INPUT);
  }

  return {
    author: normalizeRequiredString(metadata.author),
    message: normalizeRequiredString(metadata.message),
    createdBy: normalizeRequiredString(metadata.createdBy),
    timestamp: parsed.toISOString(),
    source: metadata.source,
    tags,
  };
}

function normalizeRevisionArtifacts(value: unknown): RevisionArtifactReference[] {
  if (!Array.isArray(value)) {
    throw new MigrationServiceError(ERR_MIGRATION_INVALID_INPUT, MESSAGE_MIGRATION_INVALID_INPUT);
  }
  const out: RevisionArtifactReference[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      throw new MigrationServiceError(ERR_MIGRATION_INVALID_INPUT, MESSAGE_MIGRATION_INVALID_INPUT);
    }
    const entry = item as { bundleHash?: unknown; role?: unknown };
    out.push({
      bundleHash: normalizeHash(entry.bundleHash),
      role: normalizeRequiredString(entry.role),
    });
  }
  out.sort((a, b) => compareStrings(a.bundleHash, b.bundleHash) || compareStrings(a.role, b.role));
  return out;
}

function normalizeReferences(references: ArtifactReference[] | null | undefined): ArtifactReference[] {
  const list = Array.isArray(references) ? references.map((ref) => ({ bundleHash: normalizeHash(ref.bundleHash), role: normalizeRequiredString(ref.role) })) : [];
  list.sort((a, b) => compareStrings(a.bundleHash, b.bundleHash) || compareStrings(a.role, b.role));
  return list;
}

function computeBundleHashForBundle(bundle: ArtifactBundleLike): string {
  const normalized = normalizeArtifactBundle(bundle);
  return computeBundleHash({
    schema: normalized.schema,
    packageId: normalized.identity.packageId,
    revisionId: normalized.identity.revisionId ?? null,
    revisionHash: normalized.identity.revisionHash ?? null,
    payload: normalized,
  });
}

function createRevisionCarrierBundle(revision: MigrationRevisionRecord): ArtifactBundleLike {
  return normalizeArtifactBundle({
    schema: REVISION_CARRIER_SCHEMA,
    identity: {
      packageId: revision.packageId,
      revisionId: null,
      revisionHash: null,
    },
    payload: {
      revisionHash: revision.revisionHash,
      packageId: revision.packageId,
      parentRevisionHash: revision.parentRevisionHash,
      artifacts: revision.artifacts.map((artifact) => ({ bundleHash: artifact.bundleHash, role: artifact.role })),
      metadata: {
        author: revision.metadata.author,
        message: revision.metadata.message,
        createdBy: revision.metadata.createdBy,
        timestamp: revision.metadata.timestamp,
        source: revision.metadata.source,
        tags: [...(revision.metadata.tags ?? [])],
      },
    },
    references: [],
  });
}

function parseRevisionCarrier(bundle: ArtifactBundleLike): MigrationRevisionRecord {
  if (bundle.schema !== REVISION_CARRIER_SCHEMA || !bundle.payload || typeof bundle.payload !== 'object') {
    throw new MigrationServiceError(ERR_MIGRATION_INVALID_INPUT, MESSAGE_MIGRATION_INVALID_INPUT);
  }

  const payload = bundle.payload as {
    revisionHash?: unknown;
    packageId?: unknown;
    parentRevisionHash?: unknown;
    artifacts?: unknown;
    metadata?: unknown;
  };

  const parentValue = payload.parentRevisionHash;
  const parentRevisionHash = parentValue === null || typeof parentValue === 'undefined' ? null : normalizeHash(parentValue);

  return {
    revisionHash: normalizeHash(payload.revisionHash),
    packageId: normalizeRequiredString(payload.packageId),
    parentRevisionHash,
    artifacts: normalizeRevisionArtifacts(payload.artifacts),
    metadata: normalizeMetadata(payload.metadata),
  };
}

function closeRevisionCarrierIdentity(bundle: ArtifactBundleLike, revision: MigrationRevisionRecord): MigrationRevisionRecord {
  if (bundle.identity.packageId !== revision.packageId) {
    throw new MigrationServiceError(ERR_MIGRATION_IDENTITY_MISMATCH, MESSAGE_MIGRATION_IDENTITY_MISMATCH);
  }

  return {
    revisionHash: revision.revisionHash,
    packageId: bundle.identity.packageId,
    parentRevisionHash: revision.parentRevisionHash,
    artifacts: revision.artifacts.map((artifact) => ({ bundleHash: artifact.bundleHash, role: artifact.role })),
    metadata: revision.metadata,
  };
}

function validateRevisionRecord(revision: MigrationRevisionRecord): void {
  const recomputed = computeRevisionHash({
    packageId: revision.packageId,
    parentRevisionHash: revision.parentRevisionHash,
    artifacts: revision.artifacts,
    metadata: revision.metadata,
  });

  if (recomputed !== revision.revisionHash) {
    throw new MigrationServiceError(ERR_MIGRATION_VERIFY_MISMATCH, MESSAGE_MIGRATION_VERIFY_MISMATCH);
  }
}

function createDefaultMigrationStorageAdapter(): MigrationStorageAdapter {
  const { prisma } = require('../utils') as { prisma: PrismaClient };
  const { ArtifactStoreService } = require('./artifact-store.service') as { ArtifactStoreService: new () => { storeArtifactBundle(input: { schema: string; identity: { packageId: string; revisionId?: string | null; revisionHash?: string | null }; payload: unknown; bundleHash?: string; createdAt?: string | null }): Promise<unknown> } };
  const { RevisionService } = require('./revision.service') as { RevisionService: new () => { createRevision(input: { packageId: string; parentRevisionHash?: string | null; artifacts: RevisionArtifactReference[]; metadata: { author: string; message: string; createdBy: string; timestamp: string; source: 'human' | 'ai' | 'migration' | 'system'; tags?: string[] } }): Promise<{ revisionHash: string }> } };
  const artifactStoreService = new ArtifactStoreService();
  const revisionService = new RevisionService();

  return {
    async findRevisionByHash(revisionHash: string): Promise<StoredRevisionNode | null> {
      const row = await prisma.revisionNode.findUnique({
        where: { revisionHash },
        include: { artifacts: true },
      });
      if (!row) {
        return null;
      }
      return {
        revisionHash: row.revisionHash,
        packageId: row.packageId,
        parentRevisionHash: row.parentRevisionHash,
        artifacts: row.artifacts
          .map((artifact) => ({ bundleHash: artifact.bundleHash, role: artifact.role }))
          .sort((a, b) => compareStrings(a.bundleHash, b.bundleHash) || compareStrings(a.role, b.role)),
        metadata: normalizeMetadata(row.metadata),
      };
    },

    async findArtifactByPackageAndHash(packageId: string, bundleHash: string): Promise<ArtifactBundleLike | null> {
      const row = await prisma.artifactStoreRecord.findUnique({
        where: {
          packageId_bundleHash: {
            packageId,
            bundleHash,
          },
        },
        select: { payload: true },
      });
      return row ? normalizeArtifactBundle(row.payload as ArtifactBundleLike) : null;
    },

    async findArtifactByHash(bundleHash: string): Promise<ArtifactBundleLike | null> {
      const row = await prisma.artifactStoreRecord.findFirst({
        where: { bundleHash },
        orderBy: { packageId: 'asc' },
        select: { payload: true },
      });
      return row ? normalizeArtifactBundle(row.payload as ArtifactBundleLike) : null;
    },

    async storeArtifactBundle(bundle: ArtifactBundleLike): Promise<void> {
      const normalized = normalizeArtifactBundle(bundle);
      await artifactStoreService.storeArtifactBundle({
        schema: normalized.schema,
        identity: normalized.identity,
        payload: normalized,
      });
    },

    async createRevision(revision: MigrationRevisionRecord): Promise<{ revisionHash: string }> {
      const created = await revisionService.createRevision({
        packageId: revision.packageId,
        parentRevisionHash: revision.parentRevisionHash,
        artifacts: revision.artifacts,
        metadata: {
          author: revision.metadata.author,
          message: revision.metadata.message,
          createdBy: revision.metadata.createdBy,
          timestamp: revision.metadata.timestamp,
          source: revision.metadata.source,
          ...(Array.isArray(revision.metadata.tags) ? { tags: [...revision.metadata.tags] } : {}),
        },
      });
      return { revisionHash: created.revisionHash };
    },
  };
}

function sortArtifactsForExport(artifacts: Array<{ bundleHash: string; bundle: ArtifactBundleLike }>): Array<{ bundleHash: string; bundle: ArtifactBundleLike }> {
  return [...artifacts].sort((a, b) => compareStrings(a.bundleHash, b.bundleHash));
}

function sortRevisionsAncestorFirst(rootRevisionHash: string, revisionsByHash: Map<string, MigrationRevisionRecord>): MigrationRevisionRecord[] {
  const chain: MigrationRevisionRecord[] = [];
  let currentHash: string | null = rootRevisionHash;

  while (currentHash) {
    const current = revisionsByHash.get(currentHash);
    if (!current) {
      throw new MigrationServiceError(ERR_MIGRATION_CLOSURE_INCOMPLETE, MESSAGE_MIGRATION_CLOSURE_INCOMPLETE);
    }
    chain.push(current);
    currentHash = current.parentRevisionHash;
  }

  chain.reverse();
  return chain;
}

function validateParsedPackage(parsed: {
  manifest: MigrationManifestV1;
  artifacts: ArtifactBundleLike[];
  metadata: MigrationMetadataV1;
}): {
  manifest: MigrationManifestV1;
  metadata: MigrationMetadataV1;
  allArtifacts: Array<{ bundleHash: string; bundle: ArtifactBundleLike }>;
  regularArtifacts: Array<{ bundleHash: string; bundle: ArtifactBundleLike }>;
  revisionArtifacts: Array<{ bundleHash: string; bundle: ArtifactBundleLike }>;
  revisionsAncestorFirst: MigrationRevisionRecord[];
} {
  const allArtifacts: Array<{ bundleHash: string; bundle: ArtifactBundleLike }> = [];
  const regularArtifacts: Array<{ bundleHash: string; bundle: ArtifactBundleLike }> = [];
  const revisionArtifacts: Array<{ bundleHash: string; bundle: ArtifactBundleLike }> = [];
  const bundleHashes = new Set<string>();
  const revisionsByHash = new Map<string, MigrationRevisionRecord>();

  for (const bundle of parsed.artifacts) {
    const normalized = normalizeArtifactBundle(bundle);
    const bundleHash = computeBundleHashForBundle(normalized);
    if (bundleHashes.has(bundleHash)) {
      throw new MigrationServiceError(ERR_MIGRATION_VERIFY_MISMATCH, MESSAGE_MIGRATION_VERIFY_MISMATCH);
    }
    bundleHashes.add(bundleHash);
    allArtifacts.push({ bundleHash, bundle: normalized });

    if (normalized.schema === REVISION_CARRIER_SCHEMA) {
      const revision = closeRevisionCarrierIdentity(normalized, parseRevisionCarrier(normalized));
      validateRevisionRecord(revision);
      revisionsByHash.set(revision.revisionHash, revision);
      revisionArtifacts.push({ bundleHash, bundle: normalized });
    } else {
      regularArtifacts.push({ bundleHash, bundle: normalized });
    }
  }

  for (const artifact of allArtifacts) {
    for (const reference of normalizeReferences(artifact.bundle.references)) {
      if (!bundleHashes.has(reference.bundleHash)) {
        throw new MigrationServiceError(ERR_MIGRATION_CLOSURE_INCOMPLETE, MESSAGE_MIGRATION_CLOSURE_INCOMPLETE);
      }
    }
  }

  const rootRevisionHash = normalizeHash(parsed.manifest.rootRevisionHash);
  const revisionsAncestorFirst = sortRevisionsAncestorFirst(rootRevisionHash, revisionsByHash);

  if (revisionsAncestorFirst.length !== revisionsByHash.size) {
    throw new MigrationServiceError(ERR_MIGRATION_CLOSURE_INCOMPLETE, MESSAGE_MIGRATION_CLOSURE_INCOMPLETE);
  }

  for (const revision of revisionsAncestorFirst) {
    for (const artifact of revision.artifacts) {
      if (!bundleHashes.has(artifact.bundleHash)) {
        throw new MigrationServiceError(ERR_MIGRATION_CLOSURE_INCOMPLETE, MESSAGE_MIGRATION_CLOSURE_INCOMPLETE);
      }
    }
  }

  if (parsed.manifest.artifactCount !== allArtifacts.length || parsed.manifest.revisionCount !== revisionsByHash.size) {
    throw new MigrationServiceError(ERR_MIGRATION_VERIFY_MISMATCH, MESSAGE_MIGRATION_VERIFY_MISMATCH);
  }

  return {
    manifest: parsed.manifest,
    metadata: parsed.metadata,
    allArtifacts: sortArtifactsForExport(allArtifacts),
    regularArtifacts: sortArtifactsForExport(regularArtifacts),
    revisionArtifacts: sortArtifactsForExport(revisionArtifacts),
    revisionsAncestorFirst,
  };
}

export class MigrationService {
  private readonly storage: MigrationStorageAdapter;

  constructor(storage?: MigrationStorageAdapter) {
    this.storage = storage ?? createDefaultMigrationStorageAdapter();
  }

  async computeClosure(rootRevisionHash: string): Promise<ClosureResult> {
    const normalizedRoot = normalizeHash(rootRevisionHash);
    const revisions: MigrationRevisionRecord[] = [];
    const visitedRevisions = new Set<string>();
    const artifactsByHash = new Map<string, ArtifactBundleLike>();
    const pendingReferences: ArtifactReference[] = [];

    let current = await this.storage.findRevisionByHash(normalizedRoot);
    if (!current) {
      throw new MigrationServiceError(ERR_MIGRATION_CLOSURE_INCOMPLETE, MESSAGE_MIGRATION_CLOSURE_INCOMPLETE);
    }

    while (current) {
      if (visitedRevisions.has(current.revisionHash)) {
        break;
      }

      visitedRevisions.add(current.revisionHash);
      const revision: MigrationRevisionRecord = {
        revisionHash: current.revisionHash,
        packageId: current.packageId,
        parentRevisionHash: current.parentRevisionHash,
        artifacts: current.artifacts.map((artifact) => ({ bundleHash: artifact.bundleHash, role: artifact.role })),
        metadata: current.metadata,
      };
      revisions.push(revision);

      for (const artifactRef of revision.artifacts) {
        const artifact = await this.storage.findArtifactByPackageAndHash(revision.packageId, artifactRef.bundleHash);
        if (!artifact) {
          throw new MigrationServiceError(ERR_MIGRATION_CLOSURE_INCOMPLETE, MESSAGE_MIGRATION_CLOSURE_INCOMPLETE);
        }
        const bundleHash = computeBundleHashForBundle(artifact);
        if (!artifactsByHash.has(bundleHash)) {
          artifactsByHash.set(bundleHash, artifact);
          for (const reference of normalizeReferences(artifact.references)) {
            pendingReferences.push(reference);
          }
        }
      }

      if (!revision.parentRevisionHash) {
        break;
      }

      current = await this.storage.findRevisionByHash(revision.parentRevisionHash);
      if (!current) {
        throw new MigrationServiceError(ERR_MIGRATION_CLOSURE_INCOMPLETE, MESSAGE_MIGRATION_CLOSURE_INCOMPLETE);
      }
    }

    while (pendingReferences.length > 0) {
      const reference = pendingReferences.shift() as ArtifactReference;
      if (artifactsByHash.has(reference.bundleHash)) {
        continue;
      }
      const artifact = await this.storage.findArtifactByHash(reference.bundleHash);
      if (!artifact) {
        throw new MigrationServiceError(ERR_MIGRATION_CLOSURE_INCOMPLETE, MESSAGE_MIGRATION_CLOSURE_INCOMPLETE);
      }
      const bundleHash = computeBundleHashForBundle(artifact);
      if (bundleHash !== reference.bundleHash) {
        throw new MigrationServiceError(ERR_MIGRATION_VERIFY_MISMATCH, MESSAGE_MIGRATION_VERIFY_MISMATCH);
      }
      artifactsByHash.set(bundleHash, artifact);
      for (const nested of normalizeReferences(artifact.references)) {
        pendingReferences.push(nested);
      }
    }

    const revisionArtifacts = [...revisions]
      .reverse()
      .map((revision) => {
        const bundle = createRevisionCarrierBundle(revision);
        return {
          bundleHash: computeBundleHashForBundle(bundle),
          bundle,
        };
      });

    const artifactEntries = sortArtifactsForExport([
      ...[...artifactsByHash.entries()].map(([bundleHash, bundle]) => ({ bundleHash, bundle })),
      ...revisionArtifacts,
    ]);

    return {
      rootRevisionHash: normalizedRoot,
      revisions: [...revisions].reverse(),
      artifacts: artifactEntries,
    };
  }

  async exportMigrationPackage(rootRevisionHash: string, outPath: string): Promise<string> {
    const closure = await this.computeClosure(rootRevisionHash);
    const rootRevision = closure.revisions[closure.revisions.length - 1];
    const manifest = buildManifest({
      rootRevisionHash: closure.rootRevisionHash,
      artifactCount: closure.artifacts.length,
      revisionCount: closure.revisions.length,
      createdAt: rootRevision.metadata.timestamp,
    });
    const metadata = buildMetadata({
      notes: null,
      source: 'system',
    });

    mkdirSync(path.dirname(outPath), { recursive: true });
    return writeMigrationPackageZip({
      outPath,
      manifest,
      artifactsJsonl: stringifyArtifactsJsonl(closure.artifacts.map((artifact) => artifact.bundle)),
      metadata,
    });
  }

  async verifyMigrationPackage(zipPath: string): Promise<VerifyResult> {
    const read = readMigrationPackageZip(zipPath);
    const validated = validateParsedPackage({
      manifest: read.manifest,
      metadata: read.metadata,
      artifacts: parseArtifactsJsonl(read.artifactsJsonl),
    });

    return {
      ok: true,
      rootRevisionHash: validated.manifest.rootRevisionHash,
      artifactCount: validated.manifest.artifactCount,
      revisionCount: validated.manifest.revisionCount,
      matches: true,
    };
  }

  async importMigrationPackage(zipPath: string): Promise<ImportResult> {
    const read = readMigrationPackageZip(zipPath);
    const validated = validateParsedPackage({
      manifest: read.manifest,
      metadata: read.metadata,
      artifacts: parseArtifactsJsonl(read.artifactsJsonl),
    });

    for (const artifact of validated.regularArtifacts) {
      await this.storage.storeArtifactBundle(artifact.bundle);
    }

    for (const artifact of validated.revisionArtifacts) {
      await this.storage.storeArtifactBundle(artifact.bundle);
    }

    for (const revision of validated.revisionsAncestorFirst) {
      const created = await this.storage.createRevision(revision);
      if (created.revisionHash !== revision.revisionHash) {
        throw new MigrationServiceError(ERR_MIGRATION_VERIFY_MISMATCH, MESSAGE_MIGRATION_VERIFY_MISMATCH);
      }
    }

    return {
      ok: true,
      rootRevisionHash: validated.manifest.rootRevisionHash,
      artifactCount: validated.manifest.artifactCount,
      revisionCount: validated.manifest.revisionCount,
    };
  }
}

export const MIGRATION_ERROR_CODES = {
  ERR_MIGRATION_INVALID_INPUT,
  ERR_MIGRATION_CLOSURE_INCOMPLETE,
  ERR_MIGRATION_VERIFY_MISMATCH,
  ERR_MIGRATION_IDENTITY_MISMATCH,
} as const;


