import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  buildArtifactBundleV1: vi.fn(),
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
    buildArtifactBundleV1 = mockState.buildArtifactBundleV1;
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

function buildArtifactBundle() {
  return {
    schema: 'artifact-bundle-1',
    identity: {
      packageId: '11111111-1111-4111-8111-111111111111',
      revisionId: 'rev-1',
      revisionHash: 'rev-hash-1',
    },
    artifacts: {
      transferPackageV1: {
        schema: 'transfer-package-1',
        identity: {
          packageId: '11111111-1111-4111-8111-111111111111',
          revisionId: 'rev-1',
          revisionHash: 'rev-hash-1',
          parentRevisionId: null,
        },
        transferHash: 'a'.repeat(64),
      },
      lineageBindingV1: {
        schema: 'lineage-binding-1',
        identity: {
          packageId: '11111111-1111-4111-8111-111111111111',
          revisionId: 'rev-1',
          revisionHash: 'rev-hash-1',
          parentRevisionId: null,
        },
        bindings: {
          transfer: { schema: 'transfer-package-1', transferHash: 'a'.repeat(64) },
          closure: null,
          execution: null,
          handoff: null,
        },
        diagnostics: { missing: ['closure', 'execution', 'handoff'], notes: [] },
        createdAt: null,
        lineageHash: 'b'.repeat(64),
      },
      handoffRecordV1: {
        schema: 'handoff-record-1',
        identity: {
          packageId: '11111111-1111-4111-8111-111111111111',
          revisionId: 'rev-1',
          revisionHash: 'rev-hash-1',
          parentRevisionId: null,
        },
        transfer: { schema: 'transfer-package-1', transferHash: 'a'.repeat(64) },
        handoffHash: 'c'.repeat(64),
        createdAt: null,
        lineageBindingV1: {
          schema: 'lineage-binding-1',
          identity: {
            packageId: '11111111-1111-4111-8111-111111111111',
            revisionId: 'rev-1',
            revisionHash: 'rev-hash-1',
            parentRevisionId: null,
          },
          bindings: {
            transfer: { schema: 'transfer-package-1', transferHash: 'a'.repeat(64) },
            closure: null,
            execution: null,
            handoff: null,
          },
          diagnostics: { missing: ['closure', 'execution', 'handoff'], notes: [] },
          createdAt: null,
          lineageHash: 'b'.repeat(64),
        },
      },
      closureContractV1: null,
    },
    diagnostics: {
      invariants: [
        { code: 'INV_TRANSFER_HASH_MATCH_LINEAGE', ok: true, message: 'Transfer hash matches lineage binding' },
        { code: 'INV_EMBEDDED_LINEAGE_HASH_MATCH_TOP', ok: true, message: 'Embedded lineage hash matches top-level lineage' },
        { code: 'INV_NO_HANDOFF_BINDING_IN_LINEAGE', ok: true, message: 'Lineage has no handoff binding' },
        { code: 'INV_JSON_SAFE', ok: true, message: 'Artifact bundle is JSON-safe' },
      ],
      notes: [],
    },
    createdAt: null,
    bundleHash: 'd'.repeat(64),
  };
}

afterEach(() => {
  mockState.buildArtifactBundleV1.mockReset();
});

describe('taskPackages bundle build API', () => {
  const app = buildApp();
  const routePackageId = '11111111-1111-4111-8111-111111111111';
  const body = {
    transferPackageV1: {
      schema: 'transfer-package-1',
      identity: { packageId: routePackageId },
      transferHash: 'a'.repeat(64),
    },
    lineageBindingV1: {
      schema: 'lineage-binding-1',
      identity: { packageId: routePackageId },
      lineageHash: 'b'.repeat(64),
    },
    handoffRecordV1: {
      schema: 'handoff-record-1',
      identity: { packageId: routePackageId },
      handoffHash: 'c'.repeat(64),
    },
  };

  it('returns artifactBundleV1 with a 64-lower-hex bundleHash', async () => {
    mockState.buildArtifactBundleV1.mockReturnValueOnce(buildArtifactBundle());

    const response = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/build`)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.artifactBundleV1.schema).toBe('artifact-bundle-1');
    expect(response.body.artifactBundleV1.bundleHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns identical JSON for the same request twice', async () => {
    const result = buildArtifactBundle();
    mockState.buildArtifactBundleV1.mockReturnValueOnce(result).mockReturnValueOnce(result);

    const first = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/build`)
      .send(body);
    const second = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/build`)
      .send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(second.body);
  });

  it('returns deterministic invalid input for malformed requests', async () => {
    const response = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/build`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        message: 'Invalid bundle build request',
      },
    });
  });

  it('returns deterministic invalid input for route or artifact package mismatches', async () => {
    const artifactMismatch = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/bundle/build`)
      .send({
        ...body,
        handoffRecordV1: {
          schema: 'handoff-record-1',
          identity: { packageId: '22222222-2222-4222-8222-222222222222' },
          handoffHash: 'c'.repeat(64),
        },
      });

    expect(artifactMismatch.status).toBe(400);
    expect(artifactMismatch.body).toEqual({
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        message: 'Invalid bundle build request',
      },
    });

    const routeMismatch = await request(app)
      .post('/api/v1/task-packages/33333333-3333-4333-8333-333333333333/bundle/build')
      .send(body);

    expect(routeMismatch.status).toBe(400);
    expect(routeMismatch.body).toEqual({
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        message: 'Invalid bundle build request',
      },
    });
    expect(mockState.buildArtifactBundleV1).not.toHaveBeenCalled();
  });
});
