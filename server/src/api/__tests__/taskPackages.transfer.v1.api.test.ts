import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransferPackageV1 } from '../../services/transfer-package-v1';

const mockState = vi.hoisted(() => ({
  createTransferPackage: vi.fn(),
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
    createTransferPackage = mockState.createTransferPackage;
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

function buildTransferPackage(): TransferPackageV1 {
  return {
    schema: 'transfer-package-1',
    identity: {
      packageId: 'pkg-1',
      revisionId: '11111111-1111-4111-8111-111111111111',
      revisionHash: 'rev-hash-1',
      parentRevisionId: null,
    },
    bindings: {
      closureContractV1: null,
      applyReportV1Hash: null,
      executionRecordV1Hash: null,
    },
    trunk: {
      intent: {
        primary: null,
        successCriteria: [],
        nonGoals: [],
      },
      stateDigest: {
        facts: [],
        decisions: [],
        constraints: [],
        risks: [],
        assumptions: [],
        openLoops: [],
      },
    },
    continuation: {
      nextActions: [],
      validationChecklist: [],
    },
    conflicts: [],
    determinism: {
      sorted: true,
      domainOrder: ['facts', 'decisions', 'constraints', 'risks', 'assumptions'],
    },
    transferHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  };
}

afterEach(() => {
  mockState.createTransferPackage.mockReset();
});

describe('taskPackages transfer v1 API', () => {
  const app = buildApp();

  it('returns schema=transfer-package-1 and a 64-hex transferHash for a minimal request', async () => {
    const transferPackageV1 = buildTransferPackage();
    mockState.createTransferPackage.mockResolvedValueOnce(transferPackageV1);

    const response = await request(app)
      .post('/api/v1/task-packages/11111111-1111-4111-8111-111111111111/transfer')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.transferPackageV1.schema).toBe('transfer-package-1');
    expect(response.body.transferPackageV1.transferHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same request twice', async () => {
    const transferPackageV1 = buildTransferPackage();
    mockState.createTransferPackage
      .mockResolvedValueOnce(transferPackageV1)
      .mockResolvedValueOnce(transferPackageV1);

    const body = {
      trunk: {
        intent: {
          primary: 'handoff',
          successCriteria: ['a'],
          nonGoals: ['b'],
        },
      },
    };

    const first = await request(app)
      .post('/api/v1/task-packages/11111111-1111-4111-8111-111111111111/transfer')
      .send(body);
    const second = await request(app)
      .post('/api/v1/task-packages/11111111-1111-4111-8111-111111111111/transfer')
      .send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(second.body);
    expect(first.body.transferPackageV1.transferHash).toBe(second.body.transferPackageV1.transferHash);
  });

  it('binds closureContractV1 only when include.closureContractV1=true', async () => {
    const bound = buildTransferPackage();
    bound.bindings.closureContractV1 = {
      schema: 'closure-contract-1',
      proposedHash: 'proposed-hash',
      acceptedHash: 'accepted-hash',
    };
    const unbound = buildTransferPackage();

    mockState.createTransferPackage.mockResolvedValueOnce(bound).mockResolvedValueOnce(unbound);

    const withBinding = await request(app)
      .post('/api/v1/task-packages/11111111-1111-4111-8111-111111111111/transfer')
      .send({
        include: { closureContractV1: true },
        closureContractV1: {
          schema: 'closure-contract-1',
          proposedHash: 'proposed-hash',
          acceptedHash: 'accepted-hash',
        },
      });

    const withoutBinding = await request(app)
      .post('/api/v1/task-packages/11111111-1111-4111-8111-111111111111/transfer')
      .send({
        include: { closureContractV1: false },
        closureContractV1: {
          schema: 'closure-contract-1',
          proposedHash: 'proposed-hash',
          acceptedHash: 'accepted-hash',
        },
      });

    expect(withBinding.status).toBe(200);
    expect(withBinding.body.transferPackageV1.bindings.closureContractV1).toEqual({
      schema: 'closure-contract-1',
      proposedHash: 'proposed-hash',
      acceptedHash: 'accepted-hash',
    });

    expect(withoutBinding.status).toBe(200);
    expect(withoutBinding.body.transferPackageV1.bindings.closureContractV1).toBeNull();
  });

  it('returns deterministic E_INVALID_INPUT for invalid domains in nextActions', async () => {
    const response = await request(app)
      .post('/api/v1/task-packages/11111111-1111-4111-8111-111111111111/transfer')
      .send({
        continuation: {
          nextActions: [
            {
              code: 'NEXT',
              message: 'Next',
              domains: ['invalid-domain'],
            },
          ],
        },
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        message: 'Invalid domain in nextActions',
      },
    });
  });
});
