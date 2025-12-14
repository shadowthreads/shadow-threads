/**
 * 中间件统一导出
 */
import 'global-agent/bootstrap';

export { 
  errorHandler, 
  notFoundHandler, 
  asyncHandler, 
  AppError, 
  Errors 
} from './errorHandler';

export { 
  requireAuth, 
  optionalAuth, 
  autoRegister,
  generateToken,
  verifyToken 
} from './auth';

export { requestLogger } from './requestLogger';

export { 
  validate,
  paginationSchema,
  idParamSchema,
  createSubthreadSchema,
  continueSubthreadSchema,
  listSubthreadsQuerySchema,
  saveApiKeySchema,
  updateSettingsSchema
} from './validation';

export type {
  CreateSubthreadInput,
  ContinueSubthreadInput,
  ListSubthreadsQuery,
  SaveApiKeyInput,
  UpdateSettingsInput
} from './validation';
