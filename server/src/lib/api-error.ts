import type { Response } from 'express';
import { ZodError } from 'zod';

type ErrorDescriptor = {
  status: number;
  code: string;
  message: string;
};

const INVALID_INPUT_ERROR: ErrorDescriptor = {
  status: 400,
  code: 'ERR_INVALID_INPUT',
  message: 'Invalid request',
};

const INTERNAL_ERROR: ErrorDescriptor = {
  status: 500,
  code: 'ERR_INTERNAL',
  message: 'Internal server error',
};

const ERROR_MAP: Record<string, ErrorDescriptor> = {
  E_ARTIFACT_VALIDATION: {
    status: 400,
    code: 'E_ARTIFACT_VALIDATION',
    message: 'Artifact input is invalid',
  },
  E_ARTIFACT_CONFLICT: {
    status: 409,
    code: 'E_ARTIFACT_CONFLICT',
    message: 'Artifact already exists with different payload',
  },
  ERR_ARTIFACT_NOT_FOUND: {
    status: 404,
    code: 'ERR_ARTIFACT_NOT_FOUND',
    message: 'Artifact not found',
  },
  ERR_REVISION_INVALID_INPUT: {
    status: 400,
    code: 'ERR_REVISION_INVALID_INPUT',
    message: 'Revision input is invalid',
  },
  ERR_REVISION_PARENT_NOT_FOUND: {
    status: 404,
    code: 'ERR_REVISION_PARENT_NOT_FOUND',
    message: 'Revision parent not found',
  },
  ERR_REVISION_NOT_FOUND: {
    status: 404,
    code: 'ERR_REVISION_NOT_FOUND',
    message: 'Revision not found',
  },
  ERR_EXECUTION_INVALID_INPUT: {
    status: 400,
    code: 'ERR_EXECUTION_INVALID_INPUT',
    message: 'Execution input is invalid',
  },
  ERR_EXECUTION_NOT_FOUND: {
    status: 404,
    code: 'ERR_EXECUTION_NOT_FOUND',
    message: 'Execution record not found',
  },
  ERR_EXECUTION_NON_DETERMINISTIC: {
    status: 422,
    code: 'ERR_EXECUTION_NON_DETERMINISTIC',
    message: 'Execution replay is non-deterministic',
  },
  ERR_EXECUTION_REPLAY_MISMATCH: {
    status: 422,
    code: 'ERR_EXECUTION_REPLAY_MISMATCH',
    message: 'Execution replay result hash mismatch',
  },
  ERR_MIGRATION_INVALID_INPUT: {
    status: 400,
    code: 'ERR_MIGRATION_INVALID_INPUT',
    message: 'Migration package input is invalid',
  },
  ERR_MIGRATION_CLOSURE_INCOMPLETE: {
    status: 422,
    code: 'ERR_MIGRATION_CLOSURE_INCOMPLETE',
    message: 'Migration closure is incomplete',
  },
  ERR_MIGRATION_VERIFY_MISMATCH: {
    status: 422,
    code: 'ERR_MIGRATION_VERIFY_MISMATCH',
    message: 'Migration package verification failed',
  },
  ERR_MIGRATION_IDENTITY_MISMATCH: {
    status: 422,
    code: 'ERR_MIGRATION_IDENTITY_MISMATCH',
    message: 'Migration package identity mismatch',
  },
  ERR_MIGRATION_INVALID_MANIFEST: {
    status: 422,
    code: 'ERR_MIGRATION_INVALID_MANIFEST',
    message: 'Migration package manifest is invalid',
  },
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'ApiError';
  }
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const value = error as { code?: unknown };
  return typeof value.code === 'string' ? value.code : null;
}

function resolveApiError(error: unknown): ErrorDescriptor {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof ZodError) {
    return INVALID_INPUT_ERROR;
  }

  const code = getErrorCode(error);
  if (code && ERROR_MAP[code]) {
    return ERROR_MAP[code];
  }

  return INTERNAL_ERROR;
}

export function createApiError(status: number, code: string, message: string): ApiError {
  return new ApiError(status, code, message);
}

export function createInvalidInputError(message = INVALID_INPUT_ERROR.message): ApiError {
  return new ApiError(INVALID_INPUT_ERROR.status, INVALID_INPUT_ERROR.code, message);
}

export function createNotFoundError(code: string, message: string): ApiError {
  return new ApiError(404, code, message);
}

export function sendApiOk<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ ok: true, data });
}

export function sendApiError(res: Response, error: unknown): Response {
  const mapped = resolveApiError(error);
  return res.status(mapped.status).json({
    ok: false,
    error: {
      code: mapped.code,
      message: mapped.message,
    },
  });
}
