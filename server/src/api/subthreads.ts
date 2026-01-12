/**
 * 子线程 API 路由
 */

import { Router, Request, Response } from 'express';
import {
  asyncHandler,
  requireAuth,
  validate,
  createSubthreadSchema,
  continueSubthreadSchema,
  listSubthreadsQuerySchema,
  idParamSchema,
  CreateSubthreadInput,
  ContinueSubthreadInput,
  ListSubthreadsQuery
} from '../middleware';
import { SubthreadService } from '../services/subthread.service';
import { ApiResponse } from '../types';
import { prisma } from '../utils';

const router = Router();
const subthreadService = new SubthreadService();

/**
 * 创建新子线程
 * POST /subthreads
 */
router.post(
  '/',
  requireAuth,
  validate({ body: createSubthreadSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = req.body as CreateSubthreadInput;
    const userId = req.userId!;

    const result = await subthreadService.createSubthread(userId, input);

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result
    };

    res.status(201).json(response);
  })
);

/**
 * 获取子线程列表
 * GET /subthreads
 */
router.get(
  '/',
  requireAuth,
  validate({ query: listSubthreadsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as ListSubthreadsQuery;
    const userId = req.userId!;

    const result = await subthreadService.listSubthreads(userId, query);

    const response: ApiResponse<typeof result.subthreads> = {
      success: true,
      data: result.subthreads,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total
      }
    };

    res.json(response);
  })
);

/**
 * 获取单个子线程
 * GET /subthreads/:id
 */
router.get(
  '/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.userId!;

    const subthread = await subthreadService.getSubthread(userId, id);

    const response: ApiResponse<typeof subthread> = {
      success: true,
      data: subthread
    };

    res.json(response);
  })
);

/**
 * 继续子线程对话
 * POST /subthreads/:id/messages
 */
router.post(
  '/:id/messages',
  requireAuth,
  validate({
    params: idParamSchema,
    body: continueSubthreadSchema
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const input = req.body as ContinueSubthreadInput;
    const userId = req.userId!;

    const result = await subthreadService.continueSubthread(userId, id, input);

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result
    };

    res.json(response);
  })
);

/**
 * ✅ 用户手动创建（Pin）一个 snapshot 起点
 *
 * 本步骤在做什么：
 * - 让用户在某个 subthread 的当前进度点，显式“钉住”一个可迁移的思考起点
 * - 该 snapshot 是新的 root：rootId=self, parentId=null, rev=0
 *
 * ✅ 增强：返回“认知指纹”（anchorDesc/strategy/createdAt），便于测试时确认 pin 的到底是什么状态
 *
 * POST /subthreads/:id/snapshots
 */
router.post(
  '/:id/snapshots',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id: subthreadId } = req.params;
    const userId = req.userId!;

    // 1) 确认 subthread 属于当前用户
    const subthread = await prisma.subthread.findUnique({
      where: { id: subthreadId },
      select: { id: true, userId: true }
    });

    if (!subthread) {
      const response: ApiResponse<any> = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Subthread not found' }
      };
      res.status(404).json(response);
      return;
    }

    if (subthread.userId !== userId) {
      const response: ApiResponse<any> = {
        success: false,
        error: { code: 'FORBIDDEN', message: 'Subthread exists but not owned by this user' }
      };
      res.status(403).json(response);
      return;
    }

    // 2) 找到该 subthread 最新 snapshot（作为“当前认知状态”）
    const latest = await prisma.stateSnapshot.findFirst({
      where: { subthreadId, userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        snapshot: true,
        version: true,
        createdAt: true
      }
    });

    // 按你的产品原则：不允许“凭空创建”，必须基于已有状态
    if (!latest) {
      const response: ApiResponse<any> = {
        success: false,
        error: {
          code: 'NO_BASE_SNAPSHOT',
          message: 'No snapshot exists for this subthread yet. Please run at least one shadow turn first.'
        }
      };
      res.status(409).json(response);
      return;
    }

    // 3) 从 latest.snapshot 提取“认知指纹”（用于测试可视化校验）
    const snapAny = (latest.snapshot || {}) as any;
    const anchorDesc = String(snapAny?.anchorIntent?.description || '').trim();
    const strategy = String(snapAny?.effectiveContext?.strategy || '').trim();

    // 4) 创建新的 root snapshot（事务：create -> update rootId=self）
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.stateSnapshot.create({
        data: {
          userId,
          subthreadId,
          snapshot: latest.snapshot as any,
          version: latest.version || 'v1',
          parentId: null,
          rev: 0
          // rootId 稍后补
        }
      });

      return await tx.stateSnapshot.update({
        where: { id: row.id },
        data: { rootId: row.id }
      });
    });

    const response: ApiResponse<any> = {
      success: true,
      data: {
        pinnedStateSnapshotId: created.id,
        rootId: created.rootId,
        parentId: created.parentId, // 预期 null
        rev: created.rev, // 预期 0
        subthreadId,
        version: created.version,

        // ✅ 关键：告诉你这次 pin 是“基于哪个 base snapshot”
        baseStateSnapshotId: latest.id,
        baseCreatedAt: latest.createdAt,
        baseFingerprint: {
          anchorDescPreview: anchorDesc ? anchorDesc.slice(0, 80) : '',
          strategy
        }
      }
    };

    res.json(response);
  })
);

/**
 * 归档子线程
 * POST /subthreads/:id/archive
 */
router.post(
  '/:id/archive',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.userId!;

    await subthreadService.archiveSubthread(userId, id);

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Subthread archived' }
    };

    res.json(response);
  })
);

/**
 * 删除子线程
 * DELETE /subthreads/:id
 */
router.delete(
  '/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.userId!;

    await subthreadService.deleteSubthread(userId, id);

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Subthread deleted' }
    };

    res.json(response);
  })
);

export default router;