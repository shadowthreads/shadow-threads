/**
 * 请求验证中间件
 * 使用 Zod 进行类型安全的验证
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import { LLMProvider } from '@prisma/client';

// ============================================
// 验证中间件工厂
// ============================================

interface ValidateOptions {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validate(schemas: ValidateOptions) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      if (schemas.query) {
        req.query = await schemas.query.parseAsync(req.query);
      }
      if (schemas.params) {
        req.params = await schemas.params.parseAsync(req.params);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

// ============================================
// 通用 Schema
// ============================================

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const idParamSchema = z.object({
  id: z.string().uuid()
});

// ============================================
// 子线程相关 Schema
// ============================================

export const createSubthreadSchema = z.object({
  // 来源上下文
  platform: z.string().min(1),
  conversationId: z.string().min(1),
  conversationUrl: z.string().url().optional(),
  messageId: z.string().min(1),
  messageRole: z.enum(['user', 'assistant', 'system']).default('assistant'),
  messageText: z.string().min(1).max(100000),
  selectionText: z.string().min(1).max(50000),
  selectionStart: z.number().int().min(0).optional(),
  selectionEnd: z.number().int().min(0).optional(),
  
  // 用户问题
  userQuestion: z.string().min(1).max(10000),
  
  // LLM 配置
  provider: z.nativeEnum(LLMProvider).optional(),
  model: z.string().optional()
});

export const continueSubthreadSchema = z.object({
  userQuestion: z.string().min(1).max(10000),
  provider: z.nativeEnum(LLMProvider).optional(),
  model: z.string().optional()
});

export const listSubthreadsQuerySchema = paginationSchema.extend({
  platform: z.string().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'DELETED']).optional(),
  search: z.string().optional()
});

// ============================================
// 用户相关 Schema
// ============================================

export const saveApiKeySchema = z.object({
  provider: z.nativeEnum(LLMProvider),
  apiKey: z.string().min(10).max(500),
  label: z.string().max(50).optional(),
  isDefault: z.boolean().optional()
});

export const updateSettingsSchema = z.object({
  defaultProvider: z.nativeEnum(LLMProvider).optional(),
  theme: z.enum(['auto', 'light', 'dark']).optional(),
  language: z.string().max(10).optional(),
  autoSummarize: z.boolean().optional(),
  saveHistory: z.boolean().optional()
});

// ============================================
// 导出类型
// ============================================

export type CreateSubthreadInput = z.infer<typeof createSubthreadSchema>;
export type ContinueSubthreadInput = z.infer<typeof continueSubthreadSchema>;
export type ListSubthreadsQuery = z.infer<typeof listSubthreadsQuerySchema>;
export type SaveApiKeyInput = z.infer<typeof saveApiKeySchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
