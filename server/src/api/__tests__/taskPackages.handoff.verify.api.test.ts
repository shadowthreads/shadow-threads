import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  verifyHandoffRecordV1: vi.fn(),
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
    verifyHandoffRecordV1 = mockState.verifyHandoffRecordV1;
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
  mockState.verifyHandoffRecordV1.mockReset();
});

describe('taskPackages handoff verify API', () => {
  const app = buildApp();
  const routePackageId = '11111111-1111-4111-8111-111111111111';
  const body = {
    handoffRecordV1: {
      schema: 'handoff-record-1',
      identity: {
        packageId: routePackageId,
      },
      handoffHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
  };

  it('returns 200 for a valid handoff record with matches=true', async () => {
    mockState.verifyHandoffRecordV1.mockReturnValueOnce({
      ok: true,
      recomputedHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      matches: true,
    });

    const response = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/handoff/verify`)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      recomputedHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      matches: true,
    });
  });

  it('returns 200 with matches=false when the handoff hash does not match', async () => {
    mockState.verifyHandoffRecordV1.mockReturnValueOnce({
      ok: true,
      recomputedHash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      matches: false,
    });

    const response = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/handoff/verify`)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      recomputedHash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      matches: false,
    });
  });

  it('returns deterministic invalid input for malformed requests and route mismatches', async () => {
    const invalidShape = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/handoff/verify`)
      .send({});

    expect(invalidShape.status).toBe(400);
    expect(invalidShape.body).toEqual({
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        message: 'Invalid handoff verify request',
      },
    });

    const routeMismatch = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/handoff/verify`)
      .send({
        handoffRecordV1: {
          schema: 'handoff-record-1',
          identity: {
            packageId: '22222222-2222-4222-8222-222222222222',
          },
          handoffHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
      });

    expect(routeMismatch.status).toBe(400);
    expect(routeMismatch.body).toEqual({
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        message: 'Invalid handoff verify request',
      },
    });
    expect(mockState.verifyHandoffRecordV1).toHaveBeenCalledTimes(0);
  });

  it('returns identical output for the same valid input twice', async () => {
    const result = {
      ok: true,
      recomputedHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      matches: true,
    };
    mockState.verifyHandoffRecordV1.mockReturnValueOnce(result).mockReturnValueOnce(result);

    const first = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/handoff/verify`)
      .send(body);
    const second = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/handoff/verify`)
      .send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(second.body);
  });
});
