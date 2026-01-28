/**
 * StateSnapshot API Router (thin controller)
 * - validate/auth only
 * - all business moved to StateSnapshotService
 */

import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { LLMProvider } from '@prisma/client';

import { asyncHandler, requireAuth, validate } from '../middleware';
import { idParamSchema } from '../middleware/validation';
import { StateSnapshotService } from '../services/state-snapshot.service';

const router: ExpressRouter = Router();
const svc = new StateSnapshotService();

/**
 * continue：回答 + 自动 evolve
 */
const continueFromStateSchema = z.object({
  userQuestion: z.string().min(1).max(10000),
  mode: z.enum(['bootstrap', 'constrain', 'review']).optional(),
  provider: z.nativeEnum(LLMProvider).optional(),
  model: z.string().optional(),
});
type ContinueFromStateBody = z.infer<typeof continueFromStateSchema>;

/**
 * evolve：只演化（适合补全旧 snapshot）
 */
const evolveOnlySchema = z.object({
  userQuestion: z.string().min(1).max(10000),
  assistantReply: z.string().min(1).max(40000),
  provider: z.nativeEnum(LLMProvider).optional(),
  model: z.string().optional(),
});
type EvolveOnlyBody = z.infer<typeof evolveOnlySchema>;

/**
 * 手动创建 snapshot（按钮用）
 */
const createSnapshotSchema = z.object({
  snapshot: z.any(),
  subthreadId: z.string().uuid().optional(),
  version: z.string().optional(),
});
type CreateSnapshotBody = z.infer<typeof createSnapshotSchema>;

/**
 * POST /state-snapshots
 * 手动创建 snapshot
 */
router.post(
  '/',
  requireAuth,
  validate({ body: createSnapshotSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const { snapshot, subthreadId, version } = req.body as CreateSnapshotBody;

    const created = await svc.createManualSnapshot({
      userId,
      snapshot,
      subthreadId: subthreadId ?? null,
      version,
    });

    res.json({ success: true, data: created });
  })
);

/**
 * GET /state-snapshots/:id
 */
router.get(
  '/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const id = (req.params as any).id as string;
    const userId = req.userId!;

    const owned = await svc.getOwnedSnapshot({ id, userId });
    if (!owned.ok) {
      res
        .status(owned.code === 'NOT_FOUND' ? 404 : 403)
        .json({
          success: false,
          error: {
            code: owned.code,
            message: owned.code === 'NOT_FOUND' ? 'StateSnapshot not found' : 'Forbidden',
          },
        });
      return;
    }

    res.json({ success: true, data: owned.row });
  })
);

/**
 * POST /state-snapshots/:id/continue
 */
router.post(
  '/:id/continue',
  requireAuth,
  validate({ params: idParamSchema, body: continueFromStateSchema }),
  asyncHandler(async (req, res) => {
    const id = (req.params as any).id as string;
    const userId = req.userId!;
    const { userQuestion, mode, provider, model } = req.body as ContinueFromStateBody;

    const result = await svc.continueFromSnapshot({
      id,
      userId,
      input: { userQuestion, mode, provider, model },
    });

    if (!result.ok) {
      res
        .status(result.code === 'NOT_FOUND' ? 404 : 403)
        .json({
          success: false,
          error: {
            code: result.code,
            message: result.code === 'NOT_FOUND' ? 'StateSnapshot not found' : 'Forbidden',
          },
        });
      return;
    }

    res.json({ success: true, data: result.data });
  })
);

/**
 * POST /state-snapshots/:id/evolve
 */
router.post(
  '/:id/evolve',
  requireAuth,
  validate({ params: idParamSchema, body: evolveOnlySchema }),
  asyncHandler(async (req, res) => {
    const id = (req.params as any).id as string;
    const userId = req.userId!;
    const { userQuestion, assistantReply, provider, model } = req.body as EvolveOnlyBody;

    const result = await svc.evolveSnapshot({
      id,
      userId,
      input: { userQuestion, assistantReply, provider, model },
    });

    if (!result.ok) {
      res
        .status(result.code === 'NOT_FOUND' ? 404 : 403)
        .json({
          success: false,
          error: {
            code: result.code,
            message: result.code === 'NOT_FOUND' ? 'StateSnapshot not found' : 'Forbidden',
          },
        });
      return;
    }

    res.json({ success: true, data: result.data });
  })
);

export default router;