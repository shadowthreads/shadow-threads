import type { Request, Response } from 'express';
import { createNotFoundError, sendApiError, sendApiOk } from '../lib/api-error';
import {
  executionIdParamsSchema,
  executionRecordBodySchema,
  executionReplayBodySchema,
} from '../types/api/execution.api';

export async function recordExecution(req: Request, res: Response): Promise<Response> {
  try {
    const body = executionRecordBodySchema.parse(req.body);
    const serviceModule = require('../services/execution.service') as typeof import('../services/execution.service');
    const service = new serviceModule.ExecutionService();
    const created = await service.recordExecution({
      packageId: body.packageId,
      revisionHash: body.revisionHash,
      provider: body.provider,
      model: body.model,
      promptHash: body.promptHash,
      parameters: body.parameters,
      inputArtifacts: body.inputArtifacts,
      outputArtifacts: body.outputArtifacts,
      status: body.status,
      startedAt: body.startedAt,
      finishedAt: body.finishedAt,
    });

    return sendApiOk(res, {
      executionId: created.executionId,
      resultHash: created.resultHash,
      execution: created,
    });
  } catch (error) {
    return sendApiError(res, error);
  }
}

export async function getExecution(req: Request, res: Response): Promise<Response> {
  try {
    const params = executionIdParamsSchema.parse(req.params);
    const serviceModule = require('../services/execution.service') as typeof import('../services/execution.service');
    const service = new serviceModule.ExecutionService();
    const found = await service.getExecution({ executionId: params.executionId });
    if (!found) {
      throw createNotFoundError('ERR_EXECUTION_NOT_FOUND', 'Execution record not found');
    }

    return sendApiOk(res, found);
  } catch (error) {
    return sendApiError(res, error);
  }
}

export async function replayExecution(req: Request, res: Response): Promise<Response> {
  try {
    const params = executionIdParamsSchema.parse(req.params);
    const body = executionReplayBodySchema.parse(req.body);
    const serviceModule = require('../services/execution.service') as typeof import('../services/execution.service');
    const service = new serviceModule.ExecutionService();
    const replayed = await service.replayExecution({
      executionId: params.executionId,
      promptHash: body.promptHash,
      parameters: body.parameters,
      inputArtifacts: body.inputArtifacts,
      outputArtifacts: body.outputArtifacts,
      status: body.status,
    });

    return sendApiOk(res, {
      executionId: replayed.executionId,
      verified: replayed.matches,
      resultHash: replayed.resultHash,
    });
  } catch (error) {
    return sendApiError(res, error);
  }
}
