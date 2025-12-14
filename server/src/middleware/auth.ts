/**
 * 认证中间件
 * 支持 JWT Token 和设备 ID 两种认证方式
 */

import { Request, Response, NextFunction } from 'express';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import { config, prisma, logger } from '../utils';
import { Errors, AppError } from './errorHandler';
import { User } from '@prisma/client';

// 扩展 Request 类型
declare global {
  namespace Express {
    interface Request {
      user?: User;
      userId?: string;
    }
  }
}

interface JwtPayload {
  userId: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

// ============================================
// JWT 配置 & 工具函数
// ============================================

// 显式声明 secret 类型，避免 jwt.sign 重载匹配错误
const JWT_SECRET: Secret = config.jwtSecret;

// 访问令牌和刷新令牌的过期时间
const ACCESS_TOKEN_EXPIRES_IN = config.jwtExpiresIn; // 比如 "7d"
const REFRESH_TOKEN_EXPIRES_IN = '30d';

/**
 * 生成 JWT
 */
export function generateToken(
  userId: string,
  type: 'access' | 'refresh' = 'access'
): string {
  const expiresIn =
    type === 'access' ? ACCESS_TOKEN_EXPIRES_IN : REFRESH_TOKEN_EXPIRES_IN;

  // 显式告诉 TS 这是 SignOptions，避免被当成回调 SignCallback
  const options: SignOptions = {
    // 部分类型定义对 expiresIn 要求比较死，这里用 as any 规避一下
    expiresIn: expiresIn as any,
  };

  return jwt.sign({ userId, type }, JWT_SECRET, options);
}

/**
 * 校验 JWT
 */
export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw Errors.invalidToken();
    }
    throw Errors.invalidToken();
  }
}

// ============================================
// 认证中间件
// ============================================

/**
 * 必须认证的中间件
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 0. 如果 autoRegister 已经设置了用户，直接放行
    if (req.user && req.userId) {
      return next();
    }

    // 1. 尝试从 Authorization header 获取 JWT
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);

      if (payload.type !== 'access') {
        throw Errors.invalidToken();
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
      });

      if (!user) {
        throw Errors.unauthorized('User not found');
      }

      req.user = user;
      req.userId = user.id;
      return next();
    }

    // 2. 尝试从 X-Device-ID header 获取设备 ID（匿名用户）
    const deviceId = req.headers['x-device-id'] as string;
    if (deviceId) {
      // 查找或创建设备用户
      let user = await prisma.user.findUnique({
        where: { deviceId },
      });

      if (!user) {
        // 自动创建匿名用户
        user = await prisma.user.create({
          data: {
            deviceId,
            settings: {
              create: {}, // 使用默认设置
            },
          },
        });
        logger.info('Created anonymous user', { deviceId, userId: user.id });
      }

      req.user = user;
      req.userId = user.id;
      return next();
    }

    throw Errors.unauthorized('No authentication provided');
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    return next(Errors.unauthorized());
  }
}

/**
 * 可选认证的中间件（不强制要求认证）
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 尝试认证，但不强制
    const authHeader = req.headers.authorization;
    const deviceId = req.headers['x-device-id'] as string;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const payload = verifyToken(token);
        const user = await prisma.user.findUnique({
          where: { id: payload.userId },
        });
        if (user) {
          req.user = user;
          req.userId = user.id;
        }
      } catch {
        // 忽略无效 token
      }
    } else if (deviceId) {
      const user = await prisma.user.findUnique({
        where: { deviceId },
      });
      if (user) {
        req.user = user;
        req.userId = user.id;
      }
    }

    return next();
  } catch {
    // 忽略错误，继续处理
    return next();
  }
}

// ============================================
// 设备 ID 自动注册中间件
// ============================================

/**
 * 自动为请求分配用户
 * 如果有设备 ID 就使用，否则创建临时用户
 */
export async function autoRegister(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 如果已经有用户了，直接跳过
    if (req.user) {
      return next();
    }

    // 获取设备 ID
    let deviceId = req.headers['x-device-id'] as string;

    if (!deviceId) {
      // 如果没有设备 ID，生成一个临时的
      deviceId = `temp_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 10)}`;
    }

    // 查找或创建用户
    let user = await prisma.user.findUnique({
      where: { deviceId },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          deviceId,
          settings: {
            create: {},
          },
        },
      });
    }

    req.user = user;
    req.userId = user.id;

    return next();
  } catch (error) {
    logger.error('Auto register failed', { error });
    return next(error);
  }
}