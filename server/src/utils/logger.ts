/**
 * 日志工具
 * 使用 Winston 进行结构化日志记录
 */

import winston from 'winston';
import config from './config';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// 自定义日志格式
const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  let log = `${timestamp} [${level}]: ${message}`;
  
  // 如果有额外的元数据，添加到日志中
  if (Object.keys(meta).length > 0) {
    log += ` ${JSON.stringify(meta)}`;
  }
  
  // 如果有错误堆栈，添加到日志中
  if (stack) {
    log += `\n${stack}`;
  }
  
  return log;
});

// 创建日志实例
export const logger = winston.createLogger({
  level: config.logLevel,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
      )
    })
  ]
});

// 生产环境添加文件日志
if (config.isProd) {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  );
  
  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10485760,
      maxFiles: 5
    })
  );
}

// 请求日志辅助函数
export function logRequest(req: { method: string; path: string; ip?: string }, extra?: object) {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip, ...extra });
}

// 错误日志辅助函数
export function logError(error: Error, context?: string) {
  logger.error(context ? `[${context}] ${error.message}` : error.message, { 
    stack: error.stack,
    name: error.name
  });
}

export default logger;
