import type { Request, Response } from 'express';
import { createNotFoundError, sendApiError, sendApiOk } from '../lib/api-error';
import {
  revisionCreateBodySchema,
  revisionHashParamsSchema,
  revisionListQuerySchema,
  revisionPackageParamsSchema,
} from '../types/api/revision.api';

export async function createRevision(req: Request, res: Response): Promise<Response> {
  try {
    const body = revisionCreateBodySchema.parse(req.body);
    const serviceModule = require('../services/revision.service') as typeof import('../services/revision.service');
    const service = new serviceModule.RevisionService();
    const created = await service.createRevision({
      packageId: body.packageId,
      parentRevisionHash: body.parentRevisionHash,
      artifacts: body.artifacts,
      metadata: body.metadata,
    });

    return sendApiOk(res, {
      revisionHash: created.revisionHash,
      revision: created,
    });
  } catch (error) {
    return sendApiError(res, error);
  }
}

export async function getRevision(req: Request, res: Response): Promise<Response> {
  try {
    const params = revisionHashParamsSchema.parse(req.params);
    const serviceModule = require('../services/revision.service') as typeof import('../services/revision.service');
    const service = new serviceModule.RevisionService();
    const found = await service.getRevision({ revisionHash: params.revisionHash });
    if (!found) {
      throw createNotFoundError('ERR_REVISION_NOT_FOUND', 'Revision not found');
    }

    return sendApiOk(res, found);
  } catch (error) {
    return sendApiError(res, error);
  }
}

export async function listRevisions(req: Request, res: Response): Promise<Response> {
  try {
    const params = revisionPackageParamsSchema.parse(req.params);
    const query = revisionListQuerySchema.parse(req.query);
    const serviceModule = require('../services/revision.service') as typeof import('../services/revision.service');
    const service = new serviceModule.RevisionService();
    const items = await service.listRevisions({
      packageId: params.packageId,
      limit: query.limit,
    });

    return sendApiOk(res, { items });
  } catch (error) {
    return sendApiError(res, error);
  }
}
