/**
 * Redis 客户端
 * 用于缓存和会话管理
 */

import Redis from 'ioredis';
import config from './config';
import logger from './logger';

// 创建 Redis 客户端
export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true // 延迟连接，允许在没有 Redis 时也能启动
});

// 连接事件
redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (err) => {
  logger.error('Redis error', { error: err.message });
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

// ============================================
// 缓存辅助函数
// ============================================

/**
 * 设置缓存
 */
export async function setCache<T>(
  key: string, 
  value: T, 
  ttlSeconds: number = 3600
): Promise<void> {
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (error) {
    logger.error('Failed to set cache', { key, error });
  }
}

/**
 * 获取缓存
 */
export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const value = await redis.get(key);
    if (value) {
      return JSON.parse(value) as T;
    }
    return null;
  } catch (error) {
    logger.error('Failed to get cache', { key, error });
    return null;
  }
}

/**
 * 删除缓存
 */
export async function deleteCache(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch (error) {
    logger.error('Failed to delete cache', { key, error });
  }
}

/**
 * 按模式删除缓存
 */
export async function deleteCacheByPattern(pattern: string): Promise<void> {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    logger.error('Failed to delete cache by pattern', { pattern, error });
  }
}

// ============================================
// 速率限制
// ============================================

/**
 * 检查速率限制
 */
export async function checkRateLimit(
  identifier: string,
  maxRequests: number = config.rateLimitMaxRequests,
  windowMs: number = config.rateLimitWindowMs
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const key = `ratelimit:${identifier}`;
  const windowSeconds = Math.ceil(windowMs / 1000);
  
  try {
    const current = await redis.incr(key);
    
    if (current === 1) {
      await redis.expire(key, windowSeconds);
    }
    
    const ttl = await redis.ttl(key);
    
    return {
      allowed: current <= maxRequests,
      remaining: Math.max(0, maxRequests - current),
      resetTime: Date.now() + ttl * 1000
    };
  } catch (error) {
    logger.error('Rate limit check failed', { identifier, error });
    // 出错时允许请求通过
    return { allowed: true, remaining: maxRequests, resetTime: Date.now() + windowMs };
  }
}

// 连接 Redis（可选，失败不影响启动）
export async function connectRedis(): Promise<boolean> {
  try {
    await redis.connect();
    return true;
  } catch (error) {
    logger.warn('Redis connection failed, running without cache', { error });
    return false;
  }
}

export default redis;
