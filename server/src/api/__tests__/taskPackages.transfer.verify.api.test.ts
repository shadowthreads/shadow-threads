import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  verifyTransferPackageV1: vi.fn(),
}));

vi.mock('../../middleware', async () => {
  const actual = await vi.importActual<typeof import('../../middleware')>('../../middleware');
  return {
    ...actual,
    requireAuth: (req: { userId?: string }, _res: unknown, next: () => void) => {
      req.userId = 'test-user-id';
      next();
    },
  };
});

vi.mock('../../services/task-package.service', () => {
  class MockTaskPackageService {}
  return { TaskPackageService: MockTaskPackageService };
});

vi.mock('../../services/transfer-package.service', () => {
  class MockTransferPackageService {
    verifyTransferPackageV1 = mockState.verifyTransferPackageV1;
  }

  return { TransferPackageService: MockTransferPackageService };
});

import taskPackagesRouter from '../taskPackages';

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1/task-packages', taskPackagesRouter);
  return app;
}

afterEach(() => {
  mockState.verifyTransferPackageV1.mockReset();
});

describe('taskPackages transfer verify API', () => {
  const app = buildApp();
  const routePackageId = '11111111-1111-4111-8111-111111111111';
  const body = {
    transferPackageV1: {
      schema: 'transfer-package-1',
      identity: {
        packageId: routePackageId,
      },
      transferHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
  };

  it('returns identical output for the same input twice', async () => {
    const result = {
      ok: true,
      recomputedHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      matches: true,
    };
    mockState.verifyTransferPackageV1.mockReturnValueOnce(result).mockReturnValueOnce(result);

    const first = await request(app).post(`/api/v1/task-packages/${routePackageId}/transfer/verify`).send(body);
    const second = await request(app).post(`/api/v1/task-packages/${routePackageId}/transfer/verify`).send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(second.body);
  });

  it('returns 200 with matches=false when the hash does not match', async () => {
    mockState.verifyTransferPackageV1.mockReturnValueOnce({
      ok: true,
      recomputedHash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      matches: false,
    });

    const response = await request(app).post(`/api/v1/task-packages/${routePackageId}/transfer/verify`).send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      recomputedHash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      matches: false,
    });
  });

  it('rejects a route package mismatch deterministically', async () => {
    const response = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/transfer/verify`)
      .send({
        transferPackageV1: {
          schema: 'transfer-package-1',
          identity: {
            packageId: '22222222-2222-4222-8222-222222222222',
          },
          transferHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        message: 'Invalid transfer verify request',
      },
    });
    expect(mockState.verifyTransferPackageV1).not.toHaveBeenCalled();
  });
});
