import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  verifyLineageBindingV1: vi.fn(),
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
    verifyLineageBindingV1 = mockState.verifyLineageBindingV1;
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
  mockState.verifyLineageBindingV1.mockReset();
});

describe('taskPackages lineage verify API', () => {
  const app = buildApp();
  const routePackageId = '11111111-1111-4111-8111-111111111111';
  const body = {
    lineageBindingV1: {
      schema: 'lineage-binding-1',
      identity: {
        packageId: routePackageId,
      },
      lineageHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
  };

  it('returns 200 for a valid lineage binding with matches=true', async () => {
    mockState.verifyLineageBindingV1.mockReturnValueOnce({
      ok: true,
      recomputedHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      matches: true,
    });

    const response = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/lineage/verify`)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      recomputedHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      matches: true,
    });
  });

  it('returns 200 with matches=false when the lineage hash does not match', async () => {
    mockState.verifyLineageBindingV1.mockReturnValueOnce({
      ok: true,
      recomputedHash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      matches: false,
    });

    const response = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/lineage/verify`)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      recomputedHash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      matches: false,
    });
  });

  it('returns deterministic invalid input for malformed or mismatched lineage bindings', async () => {
    const invalidShape = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/lineage/verify`)
      .send({});

    expect(invalidShape.status).toBe(400);
    expect(invalidShape.body).toEqual({
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        message: 'Invalid lineage verify request',
      },
    });

    const mismatch = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/lineage/verify`)
      .send({
        lineageBindingV1: {
          schema: 'lineage-binding-1',
          identity: {
            packageId: '22222222-2222-4222-8222-222222222222',
          },
          lineageHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
      });

    expect(mismatch.status).toBe(400);
    expect(mismatch.body).toEqual({
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        message: 'Invalid lineage verify request',
      },
    });
    expect(mockState.verifyLineageBindingV1).toHaveBeenCalledTimes(0);
  });
});
