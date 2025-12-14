/**
 * 错误处理中间件
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils';

// ============================================
// 类型定义（直接在这里定义，避免导入问题）
// ============================================

export const ErrorCodes = {
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  LLM_API_ERROR: 'LLM_API_ERROR',
  LLM_RATE_LIMIT: 'LLM_RATE_LIMIT',
  LLM_INVALID_KEY: 'LLM_INVALID_KEY',
  LLM_QUOTA_EXCEEDED: 'LLM_QUOTA_EXCEEDED',
  SUBTHREAD_NOT_FOUND: 'SUBTHREAD_NOT_FOUND',
  API_KEY_NOT_FOUND: 'API_KEY_NOT_FOUND',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
  };
}

// ============================================
// 自定义错误类
// ============================================

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;
  
  constructor(
    code: string,
    message: string,
    statusCode: number = 500,
    details?: unknown
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'AppError';
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// 预定义错误工厂
export const Errors = {
  notFound: (resource: string = 'Resource') => 
    new AppError(ErrorCodes.NOT_FOUND, `${resource} not found`, 404),
  
  unauthorized: (message: string = 'Unauthorized') =>
    new AppError(ErrorCodes.UNAUTHORIZED, message, 401),
  
  invalidToken: () =>
    new AppError(ErrorCodes.INVALID_TOKEN, 'Invalid or expired token', 401),
  
  validation: (message: string, details?: unknown) =>
    new AppError(ErrorCodes.VALIDATION_ERROR, message, 400, details),
  
  internal: (message: string = 'Internal server error') =>
    new AppError(ErrorCodes.INTERNAL_ERROR, message, 500),
  
  llmError: (message: string, details?: unknown) =>
    new AppError(ErrorCodes.LLM_API_ERROR, message, 502, details),
  
  llmRateLimit: () =>
    new AppError(ErrorCodes.LLM_RATE_LIMIT, 'LLM API rate limit exceeded', 429),
  
  llmInvalidKey: () =>
    new AppError(ErrorCodes.LLM_INVALID_KEY, 'Invalid LLM API key', 401),
  
  subthreadNotFound: () =>
    new AppError(ErrorCodes.SUBTHREAD_NOT_FOUND, 'Subthread not found', 404),
  
  apiKeyNotFound: () =>
    new AppError(ErrorCodes.API_KEY_NOT_FOUND, 'API key not found for this provider', 404),
};

// ============================================
// 错误处理中间件
// ============================================

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // 记录错误
  logger.error(`[${req.method}] ${req.path}`, {
    error: err.message,
    stack: err.stack,
    body: req.body
  });
  
  let statusCode = 500;
  let errorResponse: ApiError;
  
  // AppError - 我们自定义的错误
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorResponse = {
      code: err.code,
      message: err.message,
      details: err.details
    };
  }
  // Zod 验证错误
  else if (err instanceof ZodError) {
    statusCode = 400;
    errorResponse = {
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'Validation failed',
      details: err.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message
      }))
    };
  }
  // Prisma 错误
  else if (err.name === 'PrismaClientKnownRequestError') {
    statusCode = 400;
    errorResponse = {
      code: 'DATABASE_ERROR',
      message: 'Database operation failed',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    };
  }
  // 未知错误
  else {
    errorResponse = {
      code: ErrorCodes.INTERNAL_ERROR,
      message: process.env.NODE_ENV === 'development' 
        ? err.message 
        : 'Internal server error'
    };
  }
  
  const response: ApiResponse = {
    success: false,
    error: errorResponse
  };
  
  res.status(statusCode).json(response);
}

// ============================================
// 404 处理
// ============================================

export function notFoundHandler(req: Request, res: Response): void {
  const response: ApiResponse = {
    success: false,
    error: {
      code: ErrorCodes.NOT_FOUND,
      message: `Route ${req.method} ${req.path} not found`
    }
  };
  
  res.status(404).json(response);
}

// ============================================
// 异步处理包装器
// ============================================

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void>;

export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}