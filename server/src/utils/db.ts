/**
 * Prisma 数据库客户端
 * 单例模式，确保全局只有一个数据库连接
 */

import { PrismaClient } from '@prisma/client';
import logger from './logger';
import config from './config';

// 全局 Prisma 实例
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// 创建 Prisma 客户端
function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: config.isDev 
      ? [
          { level: 'query', emit: 'event' },
          { level: 'error', emit: 'stdout' },
          { level: 'warn', emit: 'stdout' }
        ]
      : [
          { level: 'error', emit: 'stdout' }
        ]
  });
  
  // 开发环境下记录查询日志
  if (config.isDev) {
    // @ts-ignore - Prisma 事件类型
    client.$on('query', (e: { query: string; duration: number }) => {
      logger.debug(`Query: ${e.query}`, { duration: `${e.duration}ms` });
    });
  }
  
  return client;
}

// 使用单例模式
export const prisma = global.prisma || createPrismaClient();

// 开发环境下保存到全局，避免热重载时创建多个连接
if (config.isDev) {
  global.prisma = prisma;
}

// 优雅关闭连接
async function disconnectPrisma() {
  await prisma.$disconnect();
  logger.info('Database connection closed');
}

// 监听进程退出事件
process.on('beforeExit', disconnectPrisma);
process.on('SIGINT', async () => {
  await disconnectPrisma();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await disconnectPrisma();
  process.exit(0);
});

export default prisma;
