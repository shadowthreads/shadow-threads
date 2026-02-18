import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  applyPackage: vi.fn(),
}));

vi.mock('../../middleware', async () => {
  const actual = await vi.importActual<typeof import('../../middleware')>('../../middleware');
  return {
    ...actual,
    requireAuth: (req: any, _res: any, next: any) => {
      req.userId = 'test-user-id';
      next();
    },
  };
});

vi.mock('../../services/task-package.service', () => {
  class MockTaskPackageService {
    applyPackage = mockState.applyPackage;
  }

  return { TaskPackageService: MockTaskPackageService };
});

import taskPackagesRouter from '../taskPackages';

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1/task-packages', taskPackagesRouter);
  return app;
}

afterEach(() => {
  mockState.applyPackage.mockReset();
});

describe('taskPackages apply llm delta API', () => {
  const app = buildApp();

  it('keeps legacy defaults when llmMode is omitted', async () => {
    mockState.applyPackage.mockResolvedValueOnce({
      ok: true,
      data: {
        packageId: 'pkg-1',
        revisionId: 'rev-1',
        revisionRev: 0,
        provider: 'OPENAI',
        model: 'gpt-4o-mini',
        assistantReply: { content: '' },
        applyReport: {},
      },
    });

    const response = await request(app)
      .post('/api/v1/task-packages/11111111-1111-4111-8111-111111111111/apply')
      .send({ userQuestion: 'hello' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockState.applyPackage).toHaveBeenCalledTimes(1);

    const call = mockState.applyPackage.mock.calls[0];
    expect(call[0]).toBe('test-user-id');
    expect(call[1]).toBe('11111111-1111-4111-8111-111111111111');
    expect(call[2]).toEqual({ userQuestion: 'hello', mode: undefined, provider: undefined, model: undefined });
    expect(call[3]).toBeUndefined();
  });

  it('passes llmMode=delta and llmDeltaMode through to service options', async () => {
    const llmDelta = {
      schemaVersion: 'sdiff-0.1',
      base: { revisionHash: 'a' },
      target: { revisionHash: 'b' },
      facts: { added: [], removed: [], modified: [] },
      decisions: { added: [], removed: [], modified: [] },
      constraints: { added: [], removed: [], modified: [] },
      risks: { added: [], removed: [], modified: [] },
      assumptions: { added: [], removed: [], modified: [] },
      meta: {
        determinism: { canonicalVersion: 'tpkg-0.2-canon-v1', keyStrategy: 'sig-hash-v1', tieBreakers: [] },
        collisions: { soft: [], hard: [] },
        counts: {},
      },
    };

    mockState.applyPackage.mockResolvedValueOnce({
      ok: true,
      data: {
        packageId: 'pkg-1',
        revisionId: 'rev-1',
        revisionRev: 0,
        provider: 'OPENAI',
        model: 'gpt-4o-mini',
        assistantReply: { content: '' },
        applyReport: {},
      },
    });

    const response = await request(app)
      .post('/api/v1/task-packages/11111111-1111-4111-8111-111111111111/apply')
      .send({
        userQuestion: 'apply delta',
        llmMode: 'delta',
        llmDeltaMode: 'strict',
        llmDelta,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockState.applyPackage).toHaveBeenCalledTimes(1);

    const call = mockState.applyPackage.mock.calls[0];
    expect(call[3]).toEqual({
      llmMode: 'delta',
      llmDeltaMode: 'strict',
      llmDelta,
    });
  });

  it("returns deterministic E_INVALID_INPUT for unsupported llmDeltaMode", async () => {
    const response = await request(app)
      .post('/api/v1/task-packages/11111111-1111-4111-8111-111111111111/apply')
      .send({ userQuestion: 'invalid mode', llmMode: 'delta', llmDeltaMode: 'x' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'E_INVALID_INPUT',
        message: "llmDeltaMode must be 'best_effort' or 'strict'",
      },
    });
    expect(mockState.applyPackage).not.toHaveBeenCalled();
  });

  it('maps strict conflict errors with stable code/message', async () => {
    mockState.applyPackage.mockResolvedValueOnce({ ok: false, code: 'E_LLM_DELTA_CONFLICT' });

    const response = await request(app)
      .post('/api/v1/task-packages/11111111-1111-4111-8111-111111111111/apply')
      .send({ userQuestion: 'strict', llmMode: 'delta', llmDeltaMode: 'strict' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'E_LLM_DELTA_CONFLICT',
        message: 'LLM delta contains conflicts',
      },
    });
  });
});
