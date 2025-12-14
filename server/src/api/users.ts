/**
 * 用户 API 路由
 */

import { Router, Request, Response } from 'express';
import { 
  asyncHandler, 
  requireAuth,
  validate,
  saveApiKeySchema,
  updateSettingsSchema,
  SaveApiKeyInput,
  UpdateSettingsInput
} from '../middleware';
import { UserService } from '../services/user.service';
import { ApiResponse } from '../types';

const router = Router();
const userService = new UserService();

/**
 * 获取当前用户信息
 * GET /users/me
 */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.userId!;
    
    const profile = await userService.getProfile(userId);
    
    const response: ApiResponse = {
      success: true,
      data: profile
    };
    
    res.json(response);
  })
);

/**
 * 更新用户设置
 * PATCH /users/me/settings
 */
router.patch(
  '/me/settings',
  requireAuth,
  validate({ body: updateSettingsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.userId!;
    const input = req.body as UpdateSettingsInput;
    
    const settings = await userService.updateSettings(userId, input);
    
    const response: ApiResponse = {
      success: true,
      data: settings
    };
    
    res.json(response);
  })
);

/**
 * 获取用户的 API Keys 列表（不返回实际 key）
 * GET /users/me/api-keys
 */
router.get(
  '/me/api-keys',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.userId!;
    
    const apiKeys = await userService.listApiKeys(userId);
    
    const response: ApiResponse = {
      success: true,
      data: apiKeys
    };
    
    res.json(response);
  })
);

/**
 * 保存 API Key
 * POST /users/me/api-keys
 */
router.post(
  '/me/api-keys',
  requireAuth,
  validate({ body: saveApiKeySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.userId!;
    const input = req.body as SaveApiKeyInput;
    
    const result = await userService.saveApiKey(userId, input);
    
    const response: ApiResponse = {
      success: true,
      data: result
    };
    
    res.status(201).json(response);
  })
);

/**
 * 删除 API Key
 * DELETE /users/me/api-keys/:provider
 */
router.delete(
  '/me/api-keys/:provider',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.userId!;
    const { provider } = req.params;
    
    await userService.deleteApiKey(userId, provider as any);
    
    const response: ApiResponse = {
      success: true,
      data: { message: 'API key deleted' }
    };
    
    res.json(response);
  })
);

/**
 * 验证 API Key
 * POST /users/me/api-keys/:provider/validate
 */
router.post(
  '/me/api-keys/:provider/validate',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.userId!;
    const { provider } = req.params;
    
    const result = await userService.validateApiKey(userId, provider as any);
    
    const response: ApiResponse = {
      success: true,
      data: result
    };
    
    res.json(response);
  })
);

export default router;
