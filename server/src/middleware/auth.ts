/**
 * 认证中间件
 * 支持 JWT Token 和设备 ID 两种认证方式
 *
 * 修复重点：
 * - 稳定读取 X-Device-ID（大小写/数组/空白）
 * - 关键路径打日志，定位 userId 分叉
 * - autoRegister 生成临时 deviceId 时回写到响应头，避免每次请求都变新用户
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

export function generateToken(
  userId: string,
  type: 'access' | 'refresh' = 'access'
): string {
  const expiresIn =
    type === 'access' ? ACCESS_TOKEN_EXPIRES_IN : REFRESH_TOKEN_EXPIRES_IN;

  const options: SignOptions = {
    expiresIn: expiresIn as any,
  };

  return jwt.sign({ userId, type }, JWT_SECRET, options);
}

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
// Header 工具：稳定读取 X-Device-ID
// ============================================

function readHeaderString(req: Request, keyLowerCase: string): string | undefined {
  // Node/Express 会把 header key 变成小写，但值可能是 string|string[]
  const v = req.headers[keyLowerCase];
  if (!v) return undefined;
  if (Array.isArray(v)) return v[0]?.trim() || undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

function getDeviceId(req: Request): string | undefined {
  // 统一从小写 key 读取
  // 兼容某些代理/库可能把 header 拼成不同形式的情况（最终在 Node 里都会落到小写）
  return readHeaderString(req, 'x-device-id');
}

function authDebug(req: Request, msg: string, extra?: Record<string, unknown>) {
  // 避免泄漏 token，只打 deviceId 与 userId
  logger.info(msg, {
    path: req.path,
    method: req.method,
    deviceId: getDeviceId(req),
    reqUserId: req.userId,
    ...extra,
  });
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
    // 0) 如果上游已经设置了用户，直接放行
    if (req.user && req.userId) {
      authDebug(req, '[requireAuth] bypass: already authed');
      return next();
    }

    // 1) 尝试从 Authorization header 获取 JWT
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

      authDebug(req, '[requireAuth] jwt ok', { resolvedUserId: user.id });
      return next();
    }

    // 2) 尝试从 X-Device-ID header 获取设备 ID（匿名用户）
    const deviceId = getDeviceId(req);
    if (deviceId) {
      let user = await prisma.user.findUnique({
        where: { deviceId },
      });

      if (!user) {
        // 自动创建匿名用户
        user = await prisma.user.create({
          data: {
            deviceId,
            settings: {
              create: {}, // 默认设置
            },
          },
        });
        logger.info('[requireAuth] Created anonymous user', {
          deviceId,
          userId: user.id,
        });
      }

      req.user = user;
      req.userId = user.id;

      authDebug(req, '[requireAuth] device ok', { resolvedUserId: user.id });
      return next();
    }

    authDebug(req, '[requireAuth] failed: no auth provided');
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
    const authHeader = req.headers.authorization;
    const deviceId = getDeviceId(req);

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
          authDebug(req, '[optionalAuth] jwt ok', { resolvedUserId: user.id });
        } else {
          authDebug(req, '[optionalAuth] jwt user not found', {
            payloadUserId: payload.userId,
          });
        }
      } catch {
        authDebug(req, '[optionalAuth] jwt invalid/expired');
      }
    } else if (deviceId) {
      const user = await prisma.user.findUnique({
        where: { deviceId },
      });
      if (user) {
        req.user = user;
        req.userId = user.id;
        authDebug(req, '[optionalAuth] device ok', { resolvedUserId: user.id });
      } else {
        authDebug(req, '[optionalAuth] device not found', { deviceId });
      }
    }

    return next();
  } catch {
    return next();
  }
}

// ============================================
// 设备 ID 自动注册中间件
// ============================================

/**
 * 自动为请求分配用户
 * - 如果有设备 ID：使用它查找/创建用户
 * - 如果没有设备 ID：生成临时 deviceId，并把它回写到响应头 X-Device-ID（关键！）
 */
export async function autoRegister(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (req.user) {
      authDebug(req, '[autoRegister] skip: already has user');
      return next();
    }

    let deviceId = getDeviceId(req);

    let generatedTemp = false;
    if (!deviceId) {
      // 没有 deviceId：生成临时的，并回写到响应头，确保客户端能持久化
      deviceId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      generatedTemp = true;
      res.setHeader('X-Device-ID', deviceId);
    }

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

    authDebug(req, '[autoRegister] ok', {
      resolvedUserId: user.id,
      generatedTemp,
    });

    return next();
  } catch (error) {
    logger.error('[autoRegister] failed', { error });
    return next(error);
  }
}