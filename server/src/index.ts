/**
 * Shadow Threads 服务器入口
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { config, logger, connectRedis } from './utils';
import { 
  errorHandler, 
  notFoundHandler, 
  requestLogger,
  autoRegister 
} from './middleware';
import apiRouter from './api';

async function bootstrap() {
  const app = express();
  
  // ============================================
  // 基础中间件
  // ============================================
  
  // 安全头
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));
  
  // CORS
  app.use(cors({
    origin: (origin, callback) => {
      // 允许没有 origin 的请求（如 Postman）
      if (!origin) {
        return callback(null, true);
      }
      
      // 检查是否匹配允许的来源
      const allowed = config.corsOrigins.some(pattern => {
        if (pattern.includes('*')) {
          return origin.includes(pattern.replace('*', ''));
        }
        return origin.startsWith(pattern) || origin === pattern;
      });
      
      if (allowed) {
        callback(null, true);
      } else {
        logger.warn('CORS blocked', { origin });
        callback(null, true); // 开发阶段暂时允许所有
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-ID']
  }));
  
  // 请求体解析
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  
  // 速率限制
  const limiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMaxRequests,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later'
      }
    },
    standardHeaders: true,
    legacyHeaders: false
  });
  app.use(limiter);
  
  // 请求日志
  app.use(requestLogger);
  
  // 自动用户注册
  app.use(autoRegister);
  
  // ============================================
  // API 路由
  // ============================================
  
  app.use(config.apiPrefix, apiRouter);
  
  // 兼容旧版本的简单 API（用于扩展初期测试）
  app.post('/subthread/ask', async (req, res, next) => {
    try {
      // 重定向到新 API
      req.url = `${config.apiPrefix}/subthreads`;
      apiRouter(req, res, next);
    } catch (error) {
      next(error);
    }
  });
  
  // ============================================
  // 错误处理
  // ============================================
  
  app.use(notFoundHandler);
  app.use(errorHandler);
  
  // ============================================
  // 启动服务器
  // ============================================
  
  // 连接 Redis（可选）
  await connectRedis();
  
  app.listen(config.port, () => {
    logger.info('='.repeat(50));
    logger.info(`🚀 Shadow Threads Server v${process.env.npm_package_version || '0.1.0'}`);
    logger.info(`   Environment: ${config.nodeEnv}`);
    logger.info(`   API Prefix:  ${config.apiPrefix}`);
    logger.info(`   Listening:   http://localhost:${config.port}`);
    logger.info('='.repeat(50));
    logger.info('');
    logger.info('Available endpoints:');
    logger.info(`   GET  ${config.apiPrefix}/health`);
    logger.info(`   GET  ${config.apiPrefix}/providers`);
    logger.info(`   POST ${config.apiPrefix}/subthreads`);
    logger.info(`   GET  ${config.apiPrefix}/subthreads`);
    logger.info(`   GET  ${config.apiPrefix}/subthreads/:id`);
    logger.info(`   POST ${config.apiPrefix}/subthreads/:id/messages`);
    logger.info(`   GET  ${config.apiPrefix}/users/me`);
    logger.info(`   POST ${config.apiPrefix}/users/me/api-keys`);
    logger.info('');
  });
}

// 启动
bootstrap().catch((error) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});
