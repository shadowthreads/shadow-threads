/**
 * TaskPackage API Router (thin controller)
 * - validate/auth only
 * - all business moved to TaskPackageService
 */

import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { asyncHandler, requireAuth, validate } from '../middleware';
import { idParamSchema } from '../middleware/validation';
import { LLMProvider } from '@prisma/client';
import { TaskPackageService } from '../services/task-package.service';

const router: ExpressRouter = Router();
const svc = new TaskPackageService();

/** helper: Express params can be string | string[] */
function paramToString(v: unknown): string {
  if (Array.isArray(v)) return String(v[0] ?? '');
  return String(v ?? '');
}

function sendServiceError(res: any, code: string): void {
  res
    .status(code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : 400)
    .json({ success: false, error: { code, message: code } });
}

/**
 * POST /task-packages/from-snapshot
 * 从 snapshot 生成 task package（rev=0 + currentRevision 指向它）
 */
const createFromSnapshotSchema = z.object({
  sourceSnapshotId: z.string().uuid(),
  title: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
});
type CreateFromSnapshotBody = z.infer<typeof createFromSnapshotSchema>;

router.post(
  '/from-snapshot',
  requireAuth,
  validate({ body: createFromSnapshotSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const { sourceSnapshotId, title, description } = req.body as CreateFromSnapshotBody;

    try {
      const created = await svc.createFromSnapshot(userId, {
        sourceSnapshotId,
        title,
        description,
      });

      res.json({ success: true, data: created });
    } catch (e: any) {
      const code = String(e?.message || 'UNKNOWN');
      sendServiceError(res, code);
    }
  })
);

/**
 * POST /task-packages/import
 * 导入一个 package（payload JSON）
 */
const importPackageSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  payload: z.any(),
});
type ImportPackageBody = z.infer<typeof importPackageSchema>;

router.post(
  '/import',
  requireAuth,
  validate({ body: importPackageSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const { title, description, payload } = req.body as ImportPackageBody;

    try {
      const created = await svc.importPackage(userId, { title, description, payload });
      res.json({ success: true, data: created });
    } catch (e: any) {
      const code = String(e?.message || 'UNKNOWN');
      sendServiceError(res, code);
    }
  })
);

/**
 * GET /task-packages/:id/export
 * 导出当前 revision 的 payload
 */
router.get(
  '/:id/export',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const packageId = paramToString((req.params as any).id);

    try {
      const data = await svc.exportPackage(userId, packageId);
      res.json({ success: true, data });
    } catch (e: any) {
      const code = String(e?.message || 'UNKNOWN');
      sendServiceError(res, code);
    }
  })
);

/**
 * POST /task-packages/:id/apply
 * Apply：输入 userQuestion → LLM 回复 + applyReport
 */
const applySchema = z.object({
  userQuestion: z.string().min(1).max(10000),
  mode: z.enum(['bootstrap', 'constrain', 'review']).optional(),
  provider: z.nativeEnum(LLMProvider).optional(),
  model: z.string().optional(),
});
type ApplyBody = z.infer<typeof applySchema>;

router.post(
  '/:id/apply',
  requireAuth,
  validate({ params: idParamSchema, body: applySchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const packageId = paramToString((req.params as any).id);
    const { userQuestion, mode, provider, model } = req.body as ApplyBody;

    try {
      const result = await svc.applyPackage(userId, packageId, {
        userQuestion,
        mode,
        provider,
        model,
      });

      if (!result.ok) {
        sendServiceError(res, result.code);
        return;
      }

      res.json({ success: true, data: result.data });
    } catch (e: any) {
      const code = String(e?.message || 'UNKNOWN');
      sendServiceError(res, code);
    }
  })
);

export default router;
