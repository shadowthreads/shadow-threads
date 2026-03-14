import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  verifyArtifactBundleV1: vi.fn(),
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
  class MockTransferPackageService {}
  return { TransferPackageService: MockTransferPackageService };
});

vi.mock('../../services/artifact-bundle.service', () => {
  class MockArtifactBundleService {
    verifyArtifactBundleV1 = mockState.verifyArtifactBundleV1;
  }

  return { ArtifactBundleService: MockArtifactBundleService };
});

import taskPackagesRouter from '../taskPackages';

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1/task-packages', taskPackagesRouter);
  return app;
}

afterEach(() => {
  mockState.verifyArtifactBundleV1.mockReset();
});

describe('taskPackages bundle verify API', () => {
  const app = buildApp();
  const routePackageId = '11111111-1111-4111-8111-111111111111';
  const body = {
    artifactBundleV1: {
      schema: 'artifact-bundle-1',
      identity: {
        packageId: routePackageId,
      },
      bundleHash: 'd'.repeat(64),
    },
  };

  it('returns 200 with matches=true for a valid bundle', async () => {
    mockState.verifyArtifactBundleV1.mockReturnValueOnce({
      ok: true,
      recomputedHash: 'd'.repeat(64),
      matches: true,
    });

    const response = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/verify`)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      recomputedHash: 'd'.repeat(64),
      matches: true,
    });
  });

  it('returns 200 with matches=false when bundleHash is mutated', async () => {
    mockState.verifyArtifactBundleV1.mockReturnValueOnce({
      ok: true,
      recomputedHash: 'e'.repeat(64),
      matches: false,
    });

    const response = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/verify`)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      recomputedHash: 'e'.repeat(64),
      matches: false,
    });
  });

  it('returns deterministic invalid input for malformed requests', async () => {
    const response = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/verify`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        message: 'Invalid bundle verify request',
      },
    });
  });

  it('returns deterministic invalid input for route mismatches', async () => {
    const response = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/verify`)
      .send({
        artifactBundleV1: {
          schema: 'artifact-bundle-1',
          identity: {
            packageId: '22222222-2222-4222-8222-222222222222',
          },
          bundleHash: 'd'.repeat(64),
        },
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        message: 'Invalid bundle verify request',
      },
    });
    expect(mockState.verifyArtifactBundleV1).not.toHaveBeenCalled();
  });
});
