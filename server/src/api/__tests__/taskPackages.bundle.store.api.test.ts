import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  saveBundleV1: vi.fn(),
  getBundleV1: vi.fn(),
  verifyStoredBundleV1: vi.fn(),
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
  class MockArtifactBundleService {}
  return { ArtifactBundleService: MockArtifactBundleService };
});

vi.mock('../../services/artifact-store.service', () => {
  class MockArtifactStoreService {
    saveBundleV1 = mockState.saveBundleV1;
    getBundleV1 = mockState.getBundleV1;
    verifyStoredBundleV1 = mockState.verifyStoredBundleV1;
  }

  return { ArtifactStoreService: MockArtifactStoreService };
});

import taskPackagesRouter from '../taskPackages';

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1/task-packages', taskPackagesRouter);
  return app;
}

function buildArtifactBundle() {
  return {
    schema: 'artifact-bundle-1',
    identity: {
      packageId: '11111111-1111-4111-8111-111111111111',
      revisionId: 'rev-1',
      revisionHash: 'rev-hash-1',
    },
    artifacts: {
      transferPackageV1: {},
      lineageBindingV1: {},
      handoffRecordV1: {},
      closureContractV1: null,
    },
    diagnostics: {
      invariants: [],
      notes: [],
    },
    createdAt: null,
    bundleHash: 'd'.repeat(64),
  };
}

function buildStoreRecord(createdAt: string | null) {
  return {
    schema: 'artifact-store-record-1',
    identity: {
      packageId: '11111111-1111-4111-8111-111111111111',
      revisionId: 'rev-1',
      revisionHash: 'rev-hash-1',
    },
    bundleHash: 'd'.repeat(64),
    artifactBundleV1: buildArtifactBundle(),
    createdAt,
    diagnostics: {
      notes: [],
    },
    storeHash: 'e'.repeat(64),
  };
}

afterEach(() => {
  mockState.saveBundleV1.mockReset();
  mockState.getBundleV1.mockReset();
  mockState.verifyStoredBundleV1.mockReset();
});

describe('taskPackages bundle store API', () => {
  const app = buildApp();
  const routePackageId = '11111111-1111-4111-8111-111111111111';
  const body = {
    artifactBundleV1: buildArtifactBundle(),
  };

  it('stores a bundle deterministically with the expected response shape', async () => {
    const result = { artifactStoreRecordV1: buildStoreRecord(null) };
    mockState.saveBundleV1.mockResolvedValueOnce(result).mockResolvedValueOnce(result);

    const first = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/store`)
      .send(body);
    const second = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/store`)
      .send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(second.body);
    expect(first.body.artifactStoreRecordV1.storeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns deterministic invalid input for malformed store requests and route mismatch', async () => {
    const invalid = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/store`)
      .send({});

    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        message: 'Invalid bundle store request',
      },
    });

    const mismatch = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/store`)
      .send({
        artifactBundleV1: {
          ...buildArtifactBundle(),
          identity: {
            packageId: '22222222-2222-4222-8222-222222222222',
            revisionId: 'rev-1',
            revisionHash: 'rev-hash-1',
          },
        },
      });

    expect(mismatch.status).toBe(400);
    expect(mismatch.body).toEqual({
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        message: 'Invalid bundle store request',
      },
    });
    expect(mockState.saveBundleV1).not.toHaveBeenCalled();
  });

  it('verifies stored bundles with 200 mismatch semantics and 200 not-found semantics', async () => {
    mockState.verifyStoredBundleV1
      .mockResolvedValueOnce({ ok: true, recomputedHash: 'e'.repeat(64), matches: true })
      .mockResolvedValueOnce({ ok: true, recomputedHash: 'f'.repeat(64), matches: false })
      .mockResolvedValueOnce(null);

    const match = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/store/${'d'.repeat(64)}/verify`)
      .send({});
    const mismatch = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/store/${'d'.repeat(64)}/verify`)
      .send({});
    const notFound = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/store/${'d'.repeat(64)}/verify`)
      .send({});

    expect(match.status).toBe(200);
    expect(match.body).toEqual({ ok: true, recomputedHash: 'e'.repeat(64), matches: true });
    expect(mismatch.status).toBe(200);
    expect(mismatch.body).toEqual({ ok: true, recomputedHash: 'f'.repeat(64), matches: false });
    expect(notFound.status).toBe(200);
    expect(notFound.body).toEqual({ ok: false });
  });

  it('returns deterministic invalid input for bundle store verify failures', async () => {
    mockState.verifyStoredBundleV1.mockRejectedValueOnce(new Error('boom'));

    const response = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/store/${'d'.repeat(64)}/verify`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        message: 'Invalid bundle store verify request',
      },
    });
  });
});


