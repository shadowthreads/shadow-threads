/**
 * 系统 API 路由
 * 健康检查、版本信息等
 */

import { Router, Request, Response } from 'express';
import { prisma, redis, config } from '../utils';

const router = Router();

/**
 * 健康检查
 */
router.get('/health', async (_req: Request, res: Response) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '0.1.0',
    environment: config.nodeEnv,
    services: {
      database: 'unknown',
      redis: 'unknown'
    }
  };
  
  // 检查数据库
  try {
    await prisma.$queryRaw`SELECT 1`;
    health.services.database = 'healthy';
  } catch {
    health.services.database = 'unhealthy';
    health.status = 'degraded';
  }
  
  // 检查 Redis
  try {
    await redis.ping();
    health.services.redis = 'healthy';
  } catch {
    health.services.redis = 'unhealthy';
    // Redis 不可用不影响整体状态
  }
  
  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

/**
 * 版本信息
 */
router.get('/version', (_req: Request, res: Response) => {
  res.json({
    version: process.env.npm_package_version || '0.1.0',
    name: 'Shadow Threads API',
    environment: config.nodeEnv
  });
});

/**
 * 支持的 LLM 提供商
 */
router.get('/providers', (_req: Request, res: Response) => {
  res.json({
    providers: [
      {
        id: 'OPENAI',
        name: 'OpenAI',
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
        defaultModel: 'gpt-4o',
        platforms: ['chatgpt']
      },
      {
        id: 'ANTHROPIC',
        name: 'Anthropic',
        models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
        defaultModel: 'claude-3-5-sonnet-20241022',
        platforms: ['claude']
      },
      {
        id: 'GOOGLE',
        name: 'Google AI',
        models: ['gemini-pro', 'gemini-pro-vision'],
        defaultModel: 'gemini-pro',
        platforms: ['gemini']
      },
      {
        id: 'GROQ',
        name: 'Groq',
        models: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
        defaultModel: 'llama-3.1-70b-versatile',
        platforms: []
      }
    ]
  });
});

export default router;
