import { prisma } from '../utils';
import {
  buildArtifactStoreRecordV1,
  verifyArtifactStoreRecordV1,
  type ArtifactStoreRecordV1,
  type BuildArtifactStoreRecordV1Input,
} from './artifact-store-v1';

export type SaveBundleV1Input = {
  artifactBundleV1: unknown;
  createdAt?: string | null;
  notes?: string[];
};

export type GetBundleV1Query = {
  packageId: string;
  bundleHash: string;
};

function makeStoreError(message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = 'E_STORE_INVALID';
  return error;
}

function extractArtifactBundleIdentity(value: unknown): {
  packageId: string;
  revisionId: string | null;
  revisionHash: string | null;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw makeStoreError('Artifact store record input is invalid');
  }

  const record = value as Record<string, unknown>;
  if (!record.identity || typeof record.identity !== 'object' || Array.isArray(record.identity)) {
    throw makeStoreError('Artifact store record input is invalid');
  }

  const identity = record.identity as Record<string, unknown>;
  if (typeof identity.packageId !== 'string') {
    throw makeStoreError('Artifact store record input is invalid');
  }

  return {
    packageId: identity.packageId,
    revisionId: typeof identity.revisionId === 'string' ? identity.revisionId : null,
    revisionHash: typeof identity.revisionHash === 'string' ? identity.revisionHash : null,
  };
}

export class ArtifactStoreService {
  async saveBundleV1(input: SaveBundleV1Input): Promise<{ artifactStoreRecordV1: ArtifactStoreRecordV1 }> {
    const identity = extractArtifactBundleIdentity(input.artifactBundleV1);
    const artifactStoreRecordV1 = buildArtifactStoreRecordV1({
      identity,
      artifactBundleV1: input.artifactBundleV1,
      createdAt: typeof input.createdAt === 'string' ? input.createdAt : input.createdAt === null ? null : null,
      diagnostics: {
        notes: input.notes ?? [],
      },
    });

    await prisma.artifactStoreRecord.upsert({
      where: { bundleHash: artifactStoreRecordV1.bundleHash },
      create: {
        schema: artifactStoreRecordV1.schema,
        packageId: artifactStoreRecordV1.identity.packageId,
        revisionId: artifactStoreRecordV1.identity.revisionId,
        revisionHash: artifactStoreRecordV1.identity.revisionHash,
        bundleHash: artifactStoreRecordV1.bundleHash,
        payload: artifactStoreRecordV1,
        createdAt: artifactStoreRecordV1.createdAt,
      },
      update: {
        schema: artifactStoreRecordV1.schema,
        packageId: artifactStoreRecordV1.identity.packageId,
        revisionId: artifactStoreRecordV1.identity.revisionId,
        revisionHash: artifactStoreRecordV1.identity.revisionHash,
        payload: artifactStoreRecordV1,
        createdAt: artifactStoreRecordV1.createdAt,
      },
    });

    return { artifactStoreRecordV1 };
  }

  async getBundleV1(query: GetBundleV1Query): Promise<{ artifactStoreRecordV1: ArtifactStoreRecordV1 | null }> {
    const found = await prisma.artifactStoreRecord.findFirst({
      where: {
        packageId: query.packageId,
        bundleHash: query.bundleHash,
      },
      select: {
        payload: true,
      },
    });

    return {
      artifactStoreRecordV1: found ? (found.payload as ArtifactStoreRecordV1) : null,
    };
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
