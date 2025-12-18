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