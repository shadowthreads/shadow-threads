import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HandoffRecordV1 } from '../../services/handoff-record-v1';
import type { LineageBindingV1 } from '../../services/lineage-binding-v1';

const mockState = vi.hoisted(() => ({
  ingestTransferPackageV1: vi.fn(),
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
    ingestTransferPackageV1 = mockState.ingestTransferPackageV1;
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

function buildLineageBinding(transferHash: string, createdAt: string | null): LineageBindingV1 {
  return {
    schema: 'lineage-binding-1',
    identity: {
      packageId: '11111111-1111-4111-8111-111111111111',
      revisionId: 'rev-1',
      revisionHash: 'rev-hash-1',
      parentRevisionId: null,
    },
    bindings: {
      transfer: {
        schema: 'transfer-package-1',
        transferHash,
      },
      closure: null,
      execution: null,
      handoff: null,
    },
    diagnostics: {
      missing: ['closure', 'execution', 'handoff'],
      notes: [],
    },
    createdAt,
    lineageHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  };
}

function buildHandoffRecord(createdAt: string | null): HandoffRecordV1 {
  const transferHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  return {
    schema: 'handoff-record-1',
    transfer: {
      schema: 'transfer-package-1',
      transferHash,
    },
    identity: {
      packageId: '11111111-1111-4111-8111-111111111111',
      revisionId: 'rev-1',
      revisionHash: 'rev-hash-1',
      parentRevisionId: null,
    },
    bindings: {
      closureContractV1: null,
      applyReportV1Hash: null,
      executionRecordV1Hash: null,
    },
    trunk: {
      intent: { primary: null, successCriteria: [], nonGoals: [] },
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
    diagnostics: {
      verified: true,
      verification: {
        transferHashRecomputed: transferHash,
        matchesProvidedHash: true,
      },
    },
    lineageBindingV1: buildLineageBinding(transferHash, createdAt),
    createdAt,
    handoffHash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  };
}

afterEach(() => {
  mockState.ingestTransferPackageV1.mockReset();
});

describe('taskPackages transfer ingest API', () => {
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

  it('returns identical output with embedded lineage when createdAt is omitted', async () => {
    const handoff = buildHandoffRecord(null);
    mockState.ingestTransferPackageV1.mockReturnValueOnce(handoff).mockReturnValueOnce(handoff);

    const first = await request(app).post(`/api/v1/task-packages/${routePackageId}/transfer/ingest`).send(body);
    const second = await request(app).post(`/api/v1/task-packages/${routePackageId}/transfer/ingest`).send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(second.body);
    expect(first.body.handoffRecordV1.lineageBindingV1).toBeDefined();
    expect(first.body.lineageBindingV1).toBeDefined();
    expect(first.body.handoffRecordV1.lineageBindingV1.lineageHash).toBe(first.body.lineageBindingV1.lineageHash);
    expect(first.body.handoffRecordV1.lineageBindingV1.bindings.transfer.transferHash).toBe(body.transferPackageV1.transferHash);
    expect(first.body.lineageBindingV1.bindings.transfer.transferHash).toBe(body.transferPackageV1.transferHash);
  });

  it('keeps handoffHash and lineageHash stable when createdAt differs', async () => {
    const firstHandoff = buildHandoffRecord('2025-01-01T00:00:00.000Z');
    const secondHandoff = buildHandoffRecord('2026-01-01T00:00:00.000Z');
    mockState.ingestTransferPackageV1.mockReturnValueOnce(firstHandoff).mockReturnValueOnce(secondHandoff);

    const first = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/transfer/ingest`)
      .send({ ...body, createdAt: '2025-01-01T00:00:00.000Z' });
    const second = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/transfer/ingest`)
      .send({ ...body, createdAt: '2026-01-01T00:00:00.000Z' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.handoffRecordV1.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(second.body.handoffRecordV1.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(first.body.handoffRecordV1.handoffHash).toBe(second.body.handoffRecordV1.handoffHash);
    expect(first.body.handoffRecordV1.lineageBindingV1.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(second.body.handoffRecordV1.lineageBindingV1.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(first.body.handoffRecordV1.lineageBindingV1.lineageHash).toBe(second.body.handoffRecordV1.lineageBindingV1.lineageHash);
    expect(first.body.lineageBindingV1.lineageHash).toBe(second.body.lineageBindingV1.lineageHash);
    expect(first.body.handoffRecordV1.lineageBindingV1.bindings.transfer.transferHash).toBe(body.transferPackageV1.transferHash);
    expect(second.body.handoffRecordV1.lineageBindingV1.bindings.transfer.transferHash).toBe(body.transferPackageV1.transferHash);
  });

  it('passes null bindings when include flags are set without bindings payload', async () => {
    const handoff = buildHandoffRecord(null);
    mockState.ingestTransferPackageV1.mockReturnValueOnce(handoff);

    const response = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/transfer/ingest`)
      .send({
        ...body,
        include: {
          closureContractV1: true,
          applyReportV1Hash: true,
          executionRecordV1Hash: true,
        },
      });

    expect(response.status).toBe(200);
    expect(mockState.ingestTransferPackageV1).toHaveBeenCalledWith({
      transferPackageV1: body.transferPackageV1,
      include: {
        closureContractV1: true,
        applyReportV1Hash: true,
        executionRecordV1Hash: true,
      },
      bindings: {
        closureContractV1: null,
        applyReportV1Hash: null,
        executionRecordV1Hash: null,
      },
      createdAt: null,
    });
    expect(response.body.handoffRecordV1.lineageBindingV1.lineageHash).toBe(response.body.lineageBindingV1.lineageHash);
  });

  it('passes explicit bindings through and preserves the transfer hash invariant', async () => {
    const handoff = buildHandoffRecord(null);
    handoff.bindings.closureContractV1 = {
      schema: 'closure-contract-1',
      proposedHash: 'proposed-hash',
      acceptedHash: 'accepted-hash',
    };
    handoff.bindings.applyReportV1Hash = 'apply-hash';
    handoff.bindings.executionRecordV1Hash = 'execution-hash';
    mockState.ingestTransferPackageV1.mockReturnValueOnce(handoff);

    const response = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/transfer/ingest`)
      .send({
        ...body,
        include: {
          closureContractV1: true,
          applyReportV1Hash: true,
          executionRecordV1Hash: true,
        },
        bindings: {
          closureContractV1: {
            schema: 'closure-contract-1',
            proposedHash: 'proposed-hash',
            acceptedHash: 'accepted-hash',
          },
          applyReportV1Hash: 'apply-hash',
          executionRecordV1Hash: 'execution-hash',
        },
      });

    expect(response.status).toBe(200);
    expect(mockState.ingestTransferPackageV1).toHaveBeenCalledWith({
      transferPackageV1: body.transferPackageV1,
      include: {
        closureContractV1: true,
        applyReportV1Hash: true,
        executionRecordV1Hash: true,
      },
      bindings: {
        closureContractV1: {
          schema: 'closure-contract-1',
          proposedHash: 'proposed-hash',
          acceptedHash: 'accepted-hash',
        },
        applyReportV1Hash: 'apply-hash',
        executionRecordV1Hash: 'execution-hash',
      },
      createdAt: null,
    });
    expect(response.body).toEqual({ handoffRecordV1: handoff, lineageBindingV1: handoff.lineageBindingV1 });
    expect(response.body.handoffRecordV1.lineageBindingV1.bindings.transfer.transferHash).toBe(body.transferPackageV1.transferHash);
    expect(response.body.lineageBindingV1.bindings.transfer.transferHash).toBe(body.transferPackageV1.transferHash);
  });

  it('rejects a route package mismatch deterministically', async () => {
    const response = await request(app)
      .post(`/api/v1/task-packages/${routePackageId}/transfer/ingest`)
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
        message: 'Invalid transfer ingest request',
      },
    });
    expect(mockState.ingestTransferPackageV1).not.toHaveBeenCalled();
  });
});
