import { existsSync } from 'fs';
import path from 'path';
import type { Request, Response } from 'express';
import { createApiError, createNotFoundError, sendApiError, sendApiOk } from '../lib/api-error';
import { migrationExportBodySchema, migrationZipBodySchema } from '../types/api/migration.api';

function buildZipPath(rootRevisionHash: string): string {
  return path.resolve(process.cwd(), 'tmp', 'migration', `${rootRevisionHash}.zip`);
}

function normalizeMigrationError(error: unknown): unknown {
  if (!error || typeof error !== 'object') {
    return error;
  }

  const value = error as { code?: unknown; message?: unknown };
  if (value.code === 'ENOENT') {
    return createNotFoundError('ERR_MIGRATION_NOT_FOUND', 'Migration package not found');
  }

  if (value.message === 'Migration package input is invalid') {
    return createApiError(400, 'ERR_MIGRATION_INVALID_INPUT', 'Migration package input is invalid');
  }

  return error;
}

export async function exportMigration(req: Request, res: Response): Promise<Response> {
  try {
    const body = migrationExportBodySchema.parse(req.body);
    const serviceModule = require('../services/migration.service') as typeof import('../services/migration.service');
    const service = new serviceModule.MigrationService();
    const zipPath = await service.exportMigrationPackage(body.rootRevisionHash, buildZipPath(body.rootRevisionHash));
    const verified = await service.verifyMigrationPackage(zipPath);

    return sendApiOk(res, {
      zipPath,
      manifest: {
        rootRevisionHash: verified.rootRevisionHash,
        artifactCount: verified.artifactCount,
        revisionCount: verified.revisionCount,
      },
    });
  } catch (error) {
    return sendApiError(res, normalizeMigrationError(error));
  }
}

export async function verifyMigration(req: Request, res: Response): Promise<Response> {
  try {
    const body = migrationZipBodySchema.parse(req.body);
    if (!existsSync(body.zipPath)) {
      throw createNotFoundError('ERR_MIGRATION_NOT_FOUND', 'Migration package not found');
    }
    const serviceModule = require('../services/migration.service') as typeof import('../services/migration.service');
    const service = new serviceModule.MigrationService();
    const verified = await service.verifyMigrationPackage(body.zipPath);
    return sendApiOk(res, verified);
  } catch (error) {
    return sendApiError(res, normalizeMigrationError(error));
  }
}

export async function importMigration(req: Request, res: Response): Promise<Response> {
  try {
    const body = migrationZipBodySchema.parse(req.body);
    if (!existsSync(body.zipPath)) {
      throw createNotFoundError('ERR_MIGRATION_NOT_FOUND', 'Migration package not found');
    }
    const serviceModule = require('../services/migration.service') as typeof import('../services/migration.service');
    const service = new serviceModule.MigrationService();
    const imported = await service.importMigrationPackage(body.zipPath);
    return sendApiOk(res, imported);
  } catch (error) {
    return sendApiError(res, normalizeMigrationError(error));
  }
}
