/**
 * 请求日志中间件
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils';

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();
  
  // 响应结束时记录日志
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { method, originalUrl, ip } = req;
    const { statusCode } = res;
    
    const level = statusCode >= 500 ? 'error' : 
                  statusCode >= 400 ? 'warn' : 'info';
    
    logger.log(level, `${method} ${originalUrl}`, {
      statusCode,
      duration: `${duration}ms`,
      ip,
      userId: req.userId
    });
  });
  
  next();
}
