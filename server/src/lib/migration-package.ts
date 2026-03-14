const AdmZip = require('adm-zip') as new (path?: string) => AdmZipArchive;

import { canonicalizeJson } from './artifact-hash';

const MESSAGE_MIGRATION_INVALID_INPUT = 'Migration package input is invalid';
const MESSAGE_MIGRATION_INVALID_MANIFEST = 'Migration package manifest is invalid';

export const MIGRATION_PACKAGE_SCHEMA = 'migration.package.v1';
export const MIGRATION_PACKAGE_META_SCHEMA = 'migration.package.meta.v1';
export const REVISION_CARRIER_SCHEMA = 'artifact.revision.node.v1';

export type ArtifactReference = {
  bundleHash: string;
  role: string;
};

export type ArtifactBundleLike = {
  schema: string;
  identity: {
    packageId: string;
    revisionId?: string | null;
    revisionHash?: string | null;
  };
  payload: unknown;
  references?: ArtifactReference[] | null;
};

export type MigrationManifestV1 = {
  schema: 'migration.package.v1';
  rootRevisionHash: string;
  artifactCount: number;
  revisionCount: number;
  createdAt: string;
  bundleHashAlgo: 'sha256';
  revisionHashAlgo: 'sha256';
  protocol: 'shadow-protocol-v1';
};

export type MigrationMetadataV1 = {
  schema: 'migration.package.meta.v1';
  exporter: {
    name: string;
    version: string;
  };
  notes: string | null;
  source: 'human' | 'ai' | 'system';
};

type AdmZipEntry = {
  entryName: string;
  isDirectory: boolean;
};

type AdmZipArchive = {
  addFile(entryName: string, content: Buffer): void;
  getEntries(): AdmZipEntry[];
  readAsText(entry: AdmZipEntry, encoding?: string): string;
  writeZip(targetFileName: string): void;
};

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function createMigrationPackageError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function normalizeRequiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(MESSAGE_MIGRATION_INVALID_INPUT);
  }
  return value;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || typeof value === 'undefined') return null;
  throw new Error(MESSAGE_MIGRATION_INVALID_INPUT);
}

function normalizeReferences(references: unknown): ArtifactReference[] {
  if (typeof references === 'undefined' || references === null) {
    return [];
  }
  if (!Array.isArray(references)) {
    throw new Error('Migration package input is invalid');
  }

  const out: ArtifactReference[] = [];
  for (const item of references) {
    if (!item || typeof item !== 'object') {
      throw new Error(MESSAGE_MIGRATION_INVALID_INPUT);
    }
    const entry = item as { bundleHash?: unknown; role?: unknown };
    out.push({
      bundleHash: normalizeRequiredString(entry.bundleHash).toLowerCase(),
      role: normalizeRequiredString(entry.role),
    });
  }

  out.sort((a, b) => compareStrings(a.bundleHash, b.bundleHash) || compareStrings(a.role, b.role));
  return out;
}

export function normalizeArtifactBundle(bundle: ArtifactBundleLike): ArtifactBundleLike {
  return {
    schema: normalizeRequiredString(bundle.schema),
    identity: {
      packageId: normalizeRequiredString(bundle.identity?.packageId),
      revisionId: normalizeNullableString(bundle.identity?.revisionId),
      revisionHash: normalizeNullableString(bundle.identity?.revisionHash),
    },
    payload: bundle.payload,
    references: normalizeReferences(bundle.references),
  };
}

export function stringifyArtifactBundleLine(bundle: ArtifactBundleLike): string {
  return canonicalizeJson(normalizeArtifactBundle(bundle));
}

export function stringifyArtifactsJsonl(artifacts: ArtifactBundleLike[]): string {
  const lines = artifacts.map((artifact) => stringifyArtifactBundleLine(artifact));
  return `${lines.join('\n')}\n`;
}

export function parseArtifactsJsonl(text: string): ArtifactBundleLike[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length > 0);
  const out: ArtifactBundleLike[] = [];
  for (const line of lines) {
    out.push(normalizeArtifactBundle(JSON.parse(line) as ArtifactBundleLike));
  }
  return out;
}

export function buildManifest(input: {
  rootRevisionHash: string;
  artifactCount: number;
  revisionCount: number;
  createdAt: string;
}): MigrationManifestV1 {
  return {
    schema: MIGRATION_PACKAGE_SCHEMA,
    rootRevisionHash: normalizeRequiredString(input.rootRevisionHash).toLowerCase(),
    artifactCount: input.artifactCount,
    revisionCount: input.revisionCount,
    createdAt: normalizeRequiredString(input.createdAt),
    bundleHashAlgo: 'sha256',
    revisionHashAlgo: 'sha256',
    protocol: 'shadow-protocol-v1',
  };
}

function normalizeNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw createMigrationPackageError('ERR_MIGRATION_INVALID_MANIFEST', MESSAGE_MIGRATION_INVALID_MANIFEST);
  }
  return value;
}

function validateManifest(input: unknown): MigrationManifestV1 {
  if (!input || typeof input !== 'object') {
    throw createMigrationPackageError('ERR_MIGRATION_INVALID_MANIFEST', MESSAGE_MIGRATION_INVALID_MANIFEST);
  }

  const manifest = input as {
    schema?: unknown;
    rootRevisionHash?: unknown;
    artifactCount?: unknown;
    revisionCount?: unknown;
    createdAt?: unknown;
    bundleHashAlgo?: unknown;
    revisionHashAlgo?: unknown;
    protocol?: unknown;
  };

  if (
    manifest.schema !== MIGRATION_PACKAGE_SCHEMA ||
    manifest.bundleHashAlgo !== 'sha256' ||
    manifest.revisionHashAlgo !== 'sha256' ||
    manifest.protocol !== 'shadow-protocol-v1'
  ) {
    throw createMigrationPackageError('ERR_MIGRATION_INVALID_MANIFEST', MESSAGE_MIGRATION_INVALID_MANIFEST);
  }

  return {
    schema: MIGRATION_PACKAGE_SCHEMA,
    rootRevisionHash: normalizeRequiredString(manifest.rootRevisionHash).toLowerCase(),
    artifactCount: normalizeNonNegativeInteger(manifest.artifactCount),
    revisionCount: normalizeNonNegativeInteger(manifest.revisionCount),
    createdAt: normalizeRequiredString(manifest.createdAt),
    bundleHashAlgo: 'sha256',
    revisionHashAlgo: 'sha256',
    protocol: 'shadow-protocol-v1',
  };
}

export function buildMetadata(input?: Partial<MigrationMetadataV1>): MigrationMetadataV1 {
  return {
    schema: MIGRATION_PACKAGE_META_SCHEMA,
    exporter: {
      name: normalizeRequiredString(input?.exporter?.name ?? 'shadow-threads'),
      version: normalizeRequiredString(input?.exporter?.version ?? '0.x'),
    },
    notes: normalizeNullableString(input?.notes),
    source: input?.source === 'human' || input?.source === 'ai' || input?.source === 'system' ? input.source : 'system',
  };
}

export function writeMigrationPackageZip(input: {
  outPath: string;
  manifest: MigrationManifestV1;
  artifactsJsonl: string;
  metadata: MigrationMetadataV1;
}): string {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(canonicalizeJson(input.manifest), 'utf8'));
  zip.addFile('artifacts.jsonl', Buffer.from(input.artifactsJsonl, 'utf8'));
  zip.addFile('metadata.json', Buffer.from(canonicalizeJson(input.metadata), 'utf8'));
  zip.writeZip(input.outPath);
  return input.outPath;
}

export function readMigrationPackageZip(zipPath: string): {
  manifest: MigrationManifestV1;
  artifactsJsonl: string;
  metadata: MigrationMetadataV1;
} {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const allowed = new Set(['manifest.json', 'artifacts.jsonl', 'metadata.json']);
  const byName = new Map<string, AdmZipEntry>();

  for (const entry of entries) {
    if (entry.isDirectory) {
      throw new Error(MESSAGE_MIGRATION_INVALID_INPUT);
    }
    if (entry.entryName.includes('/') || entry.entryName.includes('\\')) {
      throw new Error(MESSAGE_MIGRATION_INVALID_INPUT);
    }
    if (!allowed.has(entry.entryName)) {
      throw new Error(MESSAGE_MIGRATION_INVALID_INPUT);
    }
    byName.set(entry.entryName, entry);
  }

  if (!byName.has('manifest.json') || !byName.has('artifacts.jsonl') || !byName.has('metadata.json') || byName.size !== 3) {
    throw new Error('Migration package input is invalid');
  }

  const manifest = JSON.parse(zip.readAsText(byName.get('manifest.json') as AdmZipEntry, 'utf8')) as MigrationManifestV1;
  const artifactsJsonl = zip.readAsText(byName.get('artifacts.jsonl') as AdmZipEntry, 'utf8');
  const metadata = JSON.parse(zip.readAsText(byName.get('metadata.json') as AdmZipEntry, 'utf8')) as MigrationMetadataV1;

  return {
    manifest: validateManifest(manifest),
    artifactsJsonl,
    metadata: buildMetadata(metadata),
  };
}
