/**
 * 环境配置
 * 统一管理所有环境变量
 */

import dotenv from 'dotenv';
import path from 'path';

// 加载 .env 文件
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface Config {
  // 服务器
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  
  // 数据库
  databaseUrl: string;
  
  // Redis
  redisUrl: string;
  
  // JWT
  jwtSecret: string;
  jwtExpiresIn: string;
  
  // 加密
  encryptionKey: string;
  
  // LLM API Keys (默认)
  openaiApiKey?: string;
  anthropicApiKey?: string;
  googleAiApiKey?: string;
  deepseekApiKey?:string;
  
  // 速率限制
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  
  // 日志
  logLevel: string;
  
  // CORS
  corsOrigins: string[];
  
  // 功能开关
  isDev: boolean;
  isProd: boolean;
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid integer for environment variable: ${key}`);
  }
  return parsed;
}

export const config: Config = {
  // 服务器
  nodeEnv: getEnv('NODE_ENV', 'development'),
  port: getEnvInt('PORT', 3001),
  apiPrefix: getEnv('API_PREFIX', '/api/v1'),
  
  // 数据库
  databaseUrl: getEnv('DATABASE_URL', 'postgresql://shadow:shadow_dev_password@localhost:5432/shadow_threads'),
  
  // Redis
  redisUrl: getEnv('REDIS_URL', 'redis://localhost:6379'),
  
  // JWT
  jwtSecret: getEnv('JWT_SECRET', 'dev-secret-key-change-in-production'),
  jwtExpiresIn: getEnv('JWT_EXPIRES_IN', '7d'),
  
  // 加密
  encryptionKey: getEnv('ENCRYPTION_KEY', 'dev-encryption-key-32-chars!!!'),
  
  // LLM API Keys
  openaiApiKey: process.env.OPENAI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  googleAiApiKey: process.env.GOOGLE_AI_API_KEY,
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  
  // 速率限制
  rateLimitWindowMs: getEnvInt('RATE_LIMIT_WINDOW_MS', 60000),
  rateLimitMaxRequests: getEnvInt('RATE_LIMIT_MAX_REQUESTS', 100),
  
  // 日志
  logLevel: getEnv('LOG_LEVEL', 'debug'),
  
  // CORS
  corsOrigins: getEnv('CORS_ORIGINS', 'chrome-extension://,moz-extension://,https://chatgpt.com,https://claude.ai').split(','),
  
  // 功能开关
  get isDev() {
    return this.nodeEnv === 'development';
  },
  get isProd() {
    return this.nodeEnv === 'production';
  }
};

export default config;
