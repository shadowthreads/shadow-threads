/**
 * TaskPackage API Router (thin controller)
 * - auth + validate + service call + error mapping only
 */

import { LLMProvider } from '@prisma/client';
import { Router, type Response } from 'express';
import { z } from 'zod';

import { asyncHandler, requireAuth, validate } from '../middleware';
import { idParamSchema } from '../middleware/validation';
import { TaskPackageService } from '../services/task-package.service';

const router = Router();
const svc = new TaskPackageService();

const targetSchemaVersionSchema = z.enum(['tpkg-0.1', 'tpkg-0.2']);

/** Express params may be string | string[] */
function paramToString(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value ?? '');
}

function extractErrorCode(err: unknown): unknown {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return (err as any).code ?? err.message;
  if (err && typeof err === 'object' && 'code' in err) return (err as any).code;
  return undefined;
}

function normalizeServiceCode(code: unknown):
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'NO_REVISION'
  | 'INVALID_INPUT'
  | 'CONFLICT_RETRY_EXHAUSTED'
  | 'E_INVALID_INPUT'
  | 'E_LLM_DELTA_CONFLICT'
  | 'UNKNOWN' {
  if (typeof code !== 'string') return 'UNKNOWN';
  if (
    code === 'NOT_FOUND' ||
    code === 'FORBIDDEN' ||
    code === 'NO_REVISION' ||
    code === 'INVALID_INPUT' ||
    code === 'CONFLICT_RETRY_EXHAUSTED' ||
    code === 'E_INVALID_INPUT' ||
    code === 'E_LLM_DELTA_CONFLICT'
  ) {
    return code;
  }
  return 'UNKNOWN';
}

function errorMessageForCode(code: ReturnType<typeof normalizeServiceCode>): string {
  if (code === 'E_INVALID_INPUT') return "llmDeltaMode must be 'best_effort' or 'strict'";
  if (code === 'E_LLM_DELTA_CONFLICT') return 'LLM delta contains conflicts';
  return code;
}

function sendServiceError(res: Response, code: unknown): void {
  const normalized = normalizeServiceCode(code);
  const status =
    normalized === 'NOT_FOUND'
      ? 404
      : normalized === 'FORBIDDEN'
      ? 403
      : normalized === 'CONFLICT_RETRY_EXHAUSTED' || normalized === 'E_LLM_DELTA_CONFLICT'
      ? 409
      : 400;

  res.status(status).json({
    success: false,
    error: {
      code: normalized,
      message: errorMessageForCode(normalized),
    },
  });
}

const createFromSnapshotSchema = z.object({
  sourceSnapshotId: z.string().uuid(),
  title: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  targetSchemaVersion: targetSchemaVersionSchema.optional(),
});
type CreateFromSnapshotBody = z.infer<typeof createFromSnapshotSchema>;

router.post(
  '/from-snapshot',
  requireAuth,
  validate({ body: createFromSnapshotSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const { sourceSnapshotId, title, description, targetSchemaVersion } = req.body as CreateFromSnapshotBody;

    try {
      const input = { sourceSnapshotId, title, description };
      const data = targetSchemaVersion
        ? await svc.createFromSnapshot(userId, input, { targetSchemaVersion })
        : await svc.createFromSnapshot(userId, input);
      res.json({ success: true, data });
    } catch (err: unknown) {
      sendServiceError(res, extractErrorCode(err));
    }
  })
);

const importPackageSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  payload: z.unknown(),
  targetSchemaVersion: targetSchemaVersionSchema.optional(),
});
type ImportPackageBody = z.infer<typeof importPackageSchema>;

router.post(
  '/import',
  requireAuth,
  validate({ body: importPackageSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const { title, description, payload, targetSchemaVersion } = req.body as ImportPackageBody;

    try {
      const input = { title, description, payload };
      const data = targetSchemaVersion
        ? await svc.importPackage(userId, input, { targetSchemaVersion })
        : await svc.importPackage(userId, input);
      res.json({ success: true, data });
    } catch (err: unknown) {
      sendServiceError(res, extractErrorCode(err));
    }
  })
);

router.get(
  '/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const packageId = paramToString((req.params as { id?: string | string[] }).id);

    try {
      const data = await svc.getPackage(userId, packageId);
      res.json({ success: true, data });
    } catch (err: unknown) {
      sendServiceError(res, extractErrorCode(err));
    }
  })
);

const createRevisionSchema = z.object({
  payload: z.unknown(),
  schemaVersion: z.string().optional(),
  summary: z.string().optional(),
  setCurrent: z.boolean().optional(),
  parentRevisionId: z.string().uuid().nullable().optional(),
});
type CreateRevisionBody = z.infer<typeof createRevisionSchema>;

router.post(
  '/:id/revisions',
  requireAuth,
  validate({ params: idParamSchema, body: createRevisionSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const body = req.body as CreateRevisionBody;

    try {
      const data = await svc.createRevision(userId, packageId, {
        payload: body.payload ?? {},
        schemaVersion: body.schemaVersion,
        summary: body.summary,
        setCurrent: body.setCurrent,
        parentRevisionId: body.parentRevisionId,
      });
      res.json({ success: true, data });
    } catch (err: unknown) {
      sendServiceError(res, extractErrorCode(err));
    }
  })
);

const setCurrentRevisionSchema = z.object({
  revisionId: z.string().uuid(),
});
type SetCurrentRevisionBody = z.infer<typeof setCurrentRevisionSchema>;

router.post(
  '/:id/set-current',
  requireAuth,
  validate({ params: idParamSchema, body: setCurrentRevisionSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const { revisionId } = req.body as SetCurrentRevisionBody;

    try {
      const data = await svc.setCurrentRevision(userId, packageId, revisionId);
      res.json({ success: true, data });
    } catch (err: unknown) {
      sendServiceError(res, extractErrorCode(err));
    }
  })
);

router.get(
  '/:id/export',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const packageId = paramToString((req.params as { id?: string | string[] }).id);

    try {
      const data = await svc.exportPackage(userId, packageId);
      res.json({ success: true, data });
    } catch (err: unknown) {
      sendServiceError(res, extractErrorCode(err));
    }
  })
);

const applySchema = z.object({
  userQuestion: z.string().min(1).max(10000),
  mode: z.enum(['bootstrap', 'constrain', 'review']).optional(),
  provider: z.nativeEnum(LLMProvider).optional(),
  model: z.string().optional(),
  llmMode: z.enum(['legacy', 'delta']).optional(),
  llmDeltaMode: z.string().optional(),
  llmDelta: z.unknown().optional(),
});
type ApplyBody = z.infer<typeof applySchema>;

router.post(
  '/:id/apply',
  requireAuth,
  validate({ params: idParamSchema, body: applySchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const { userQuestion, mode, provider, model, llmMode, llmDeltaMode, llmDelta } = req.body as ApplyBody;

    try {
      if (llmDeltaMode !== undefined && llmDeltaMode !== 'best_effort' && llmDeltaMode !== 'strict') {
        sendServiceError(res, 'E_INVALID_INPUT');
        return;
      }

      const applyOptions =
        llmMode === 'delta'
          ? {
              llmMode: 'delta' as const,
              llmDeltaMode: (llmDeltaMode as 'best_effort' | 'strict' | undefined) ?? 'best_effort',
              llmDelta,
            }
          : undefined;

      const result = await svc.applyPackage(
        userId,
        packageId,
        {
          userQuestion,
          mode,
          provider,
          model,
        },
        applyOptions
      );

      if (!result.ok) {
        sendServiceError(res, result.code);
        return;
      }

      res.json({ success: true, data: result.data });
    } catch (err: unknown) {
      sendServiceError(res, extractErrorCode(err));
    }
  })
);

export default router;
