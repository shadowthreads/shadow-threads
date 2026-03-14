import type { Request, Response } from 'express';
import { createNotFoundError, sendApiError, sendApiOk } from '../lib/api-error';
import { artifactCreateBodySchema, artifactRouteParamsSchema, type ArtifactCreateBody } from '../types/api/artifact.api';

function toArtifactBundle(body: ArtifactCreateBody) {
  return {
    schema: body.schema,
    identity: {
      packageId: body.identity.packageId,
      revisionId: body.identity.revisionId ?? null,
      revisionHash: body.identity.revisionHash ?? null,
    },
    payload: body.payload,
    references: body.references,
  };
}

export async function createArtifact(req: Request, res: Response): Promise<Response> {
  try {
    const body = artifactCreateBodySchema.parse(req.body);
    const serviceModule = require('../services/artifact-store.service') as typeof import('../services/artifact-store.service');
    const service = new serviceModule.ArtifactStoreService();
    const artifactBundle = toArtifactBundle(body);
    const stored = await service.storeArtifactBundle({
      schema: artifactBundle.schema,
      identity: artifactBundle.identity,
      payload: artifactBundle,
    });

    return sendApiOk(res, {
      id: stored.id,
      bundleHash: stored.bundleHash,
      createdAt: stored.createdAt,
    });
  } catch (error) {
    return sendApiError(res, error);
  }
}

export async function getArtifact(req: Request, res: Response): Promise<Response> {
  try {
    const params = artifactRouteParamsSchema.parse(req.params);
    const serviceModule = require('../services/artifact-store.service') as typeof import('../services/artifact-store.service');
    const service = new serviceModule.ArtifactStoreService();
    const found = await service.loadArtifactBundle(params);
    if (!found) {
      throw createNotFoundError('ERR_ARTIFACT_NOT_FOUND', 'Artifact not found');
    }

    return sendApiOk(res, {
      id: found.id,
      bundleHash: found.bundleHash,
      createdAt: found.createdAt,
      artifactBundle: found.payload,
    });
  } catch (error) {
    return sendApiError(res, error);
  }
}

export async function verifyArtifact(req: Request, res: Response): Promise<Response> {
  try {
    const params = artifactRouteParamsSchema.parse(req.params);
    const serviceModule = require('../services/artifact-store.service') as typeof import('../services/artifact-store.service');
    const service = new serviceModule.ArtifactStoreService();
    const found = await service.loadArtifactBundle(params);
    if (!found) {
      throw createNotFoundError('ERR_ARTIFACT_NOT_FOUND', 'Artifact not found');
    }

    const verification = service.verifyArtifactBundle({
      schema: found.schema,
      identity: found.identity,
      payload: found.payload,
      bundleHash: found.bundleHash,
    });

    return sendApiOk(res, {
      bundleHash: found.bundleHash,
      verified: verification.ok,
    });
  } catch (error) {
    return sendApiError(res, error);
  }
}
