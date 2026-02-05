import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import apiRouter from '../src/api';
import { errorHandler, notFoundHandler } from '../src/middleware';
import { prisma } from '../src/utils';

const mockState = vi.hoisted(() => {
  let userId = '';
  let lastSystemPrompt = '';
  return {
    fixedReply: 'MOCK_ASSISTANT_REPLY',
    setUserId: (id: string) => {
      userId = id;
    },
    getUserId: () => userId,
    setLastSystemPrompt: (content: string) => {
      lastSystemPrompt = content;
    },
    getLastSystemPrompt: () => lastSystemPrompt,
  };
});

vi.mock('../src/middleware', async () => {
  const errorHandlerModule = await vi.importActual<typeof import('../src/middleware/errorHandler')>(
    '../src/middleware/errorHandler'
  );
  const validationModule = await vi.importActual<typeof import('../src/middleware/validation')>(
    '../src/middleware/validation'
  );
  return {
    ...errorHandlerModule,
    ...validationModule,
    requireAuth: (req: any, _res: any, next: any) => {
      req.userId = mockState.getUserId();
      next();
    },
  };
});

vi.mock('../src/services/llm.service', () => {
  class MockLLMService {
    async complete(request: any) {
      const systemMsg = Array.isArray(request?.messages)
        ? request.messages.find((m: any) => m?.role === 'system')
        : null;
      mockState.setLastSystemPrompt(systemMsg?.content || '');
      return {
        content: mockState.fixedReply,
        promptTokens: 10,
        completionTokens: 5,
        model: 'gpt-4o-mini',
        finishReason: 'stop',
      };
    }
    async validateApiKey() {
      return true;
    }
  }
  return { LLMService: MockLLMService };
});

vi.mock('../src/services/user.service', () => {
  class MockUserService {
    async getDecryptedApiKey() {
      return 'dummy';
    }
  }
  return { UserService: MockUserService };
});

function buildTestApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/v1', apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('TaskPackage integration flow', () => {
  const app = buildTestApp();
  let testUserId = '';
  const createdSubthreadIds: string[] = [];
  const createdSourceContextIds: string[] = [];
  const createdSnapshotIds: string[] = [];
  const createdPackageIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: 'Test User',
        deviceId: `device-${Date.now()}`,
      },
    });
    testUserId = user.id;
    mockState.setUserId(testUserId);
  });

  afterAll(async () => {
    if (createdPackageIds.length > 0) {
      const pkgIds = Array.from(new Set(createdPackageIds));
      await prisma.taskPackageRevision.deleteMany({ where: { packageId: { in: pkgIds } } });
      await prisma.taskPackage.deleteMany({ where: { id: { in: pkgIds } } });
    }

    if (createdSnapshotIds.length > 0) {
      const snapIds = Array.from(new Set(createdSnapshotIds));
      await prisma.stateSnapshot.deleteMany({ where: { id: { in: snapIds } } });
    }

    if (createdSubthreadIds.length > 0) {
      const subIds = Array.from(new Set(createdSubthreadIds));
      await prisma.subthreadMessage.deleteMany({ where: { subthreadId: { in: subIds } } });
      const rows = await prisma.subthread.findMany({
        where: { id: { in: subIds } },
        select: { sourceContextId: true },
      });
      rows.forEach((row) => {
        if (row.sourceContextId) createdSourceContextIds.push(row.sourceContextId);
      });
      await prisma.subthread.deleteMany({ where: { id: { in: subIds } } });
    }

    if (createdSourceContextIds.length > 0) {
      const scIds = Array.from(new Set(createdSourceContextIds));
      await prisma.sourceContext.deleteMany({ where: { id: { in: scIds } } });
    }

    if (testUserId) {
      await prisma.userApiKey.deleteMany({ where: { userId: testUserId } });
      await prisma.user.deleteMany({ where: { id: testUserId } });
    }

    await prisma.$disconnect();
  });

  it('runs the full TaskPackage flow deterministically', async () => {
    const selectionText = 'Selection '.repeat(80);
    const messageText = 'Full message context '.repeat(60);

    const createSubthreadRes = await request(app)
      .post('/api/v1/subthreads')
      .send({
        platform: 'web',
        conversationId: 'conv-smoke-001',
        conversationUrl: 'https://example.com/conv/1',
        messageId: 'msg-smoke-001',
        messageRole: 'assistant',
        messageText,
        selectionText,
        userQuestion: 'Summarize the selection and list key risks.',
        contextMessages: [
          { id: 'ctx-1', role: 'user', content: 'Earlier we agreed to keep responses deterministic.' },
          { id: 'ctx-2', role: 'assistant', content: 'We will return structured applyReport data.' },
        ],
      });

    expect(createSubthreadRes.status).toBe(201);
    expect(createSubthreadRes.body.success).toBe(true);
    const subthreadId = createSubthreadRes.body.data.subthread.id;
    expect(subthreadId).toBeTruthy();
    createdSubthreadIds.push(subthreadId);

    const createdSubthread = await prisma.subthread.findUnique({
      where: { id: subthreadId },
      include: { sourceContext: true },
    });
    expect(createdSubthread?.sourceContext?.contextMessages).toBeTruthy();
    const storedContextMessages = createdSubthread?.sourceContext?.contextMessages as any[];
    expect(Array.isArray(storedContextMessages)).toBe(true);
    expect(storedContextMessages.length).toBe(2);
    expect(storedContextMessages[0]?.role).toBe('user');
    expect(storedContextMessages[1]?.role).toBe('assistant');

    const pinSnapshotRes = await request(app).post(`/api/v1/subthreads/${subthreadId}/snapshots`);
    expect(pinSnapshotRes.status).toBe(200);
    expect(pinSnapshotRes.body.success).toBe(true);
    const pinnedSnapshotId = pinSnapshotRes.body.data.pinnedStateSnapshotId;
    const baseSnapshotId = pinSnapshotRes.body.data.baseStateSnapshotId;
    expect(pinnedSnapshotId).toBeTruthy();
    expect(baseSnapshotId).toBeTruthy();
    createdSnapshotIds.push(pinnedSnapshotId, baseSnapshotId);

    const createPackageRes = await request(app)
      .post('/api/v1/task-packages/from-snapshot')
      .send({
        sourceSnapshotId: pinnedSnapshotId,
        title: 'Smoke Test Package',
        description: 'Created from pinned snapshot',
      });

    expect(createPackageRes.status).toBe(200);
    expect(createPackageRes.body.success).toBe(true);
    const packageId = createPackageRes.body.data.pkg.id;
    const revisionId = createPackageRes.body.data.revision.id;
    expect(packageId).toBeTruthy();
    expect(revisionId).toBeTruthy();
    createdPackageIds.push(packageId);

    const exportRes = await request(app).get(`/api/v1/task-packages/${packageId}/export`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.success).toBe(true);
    expect(exportRes.body.data.revision.rev).toBe(0);
    expect(exportRes.body.data.payload.manifest.schemaVersion).toBe('tpkg-0.1');

    const applyRes = await request(app)
      .post(`/api/v1/task-packages/${packageId}/apply`)
      .send({ userQuestion: 'Given this package, what should I do next?', mode: 'review' });

    expect(applyRes.status).toBe(200);
    expect(applyRes.body.success).toBe(true);
    expect(applyRes.body.data.assistantReply.content).toBe(mockState.fixedReply);
    expect(applyRes.body.data.applyReport.contract.conflictHandling).toBe('report_only');
    expect(applyRes.body.data.applyReport.findings.liftedFromVersion).not.toBe('tpkg-0.2');
    expect(applyRes.body.data.applyReport.findings.missingFields).toContain('intent.successCriteria');
    expect(applyRes.body.data.applyReport.conflicts.length).toBe(0);
    expect(applyRes.body.data.applyReport.counts).toEqual(
      expect.objectContaining({
        facts: expect.any(Number),
        decisions: expect.any(Number),
        assumptions: expect.any(Number),
        openLoops: expect.any(Number),
        evidence: expect.any(Number),
      })
    );

    const v2Payload = {
      manifest: {
        schemaVersion: 'tpkg-0.2',
        packageId: '11111111-1111-1111-1111-111111111111',
        createdAt: '2026-02-05T00:00:00Z',
        updatedAt: '2026-02-05T00:00:00Z',
        title: 'V2 Package',
        description: 'V2 apply test',
        capabilities: {
          applyModes: ['bootstrap', 'constrain', 'review'],
          conflictHandling: 'report_only',
        },
      },
      intent: {
        primary: 'Keep runtime stable',
        successCriteria: [],
        nonGoals: ['Do not change database'],
      },
      state: {
        facts: [],
        decisions: [],
        assumptions: [],
        openLoops: [],
      },
      constraints: {
        technical: ['No runtime code changes'],
        process: [],
        policy: [],
      },
      interfaces: {
        apis: [],
        modules: [],
      },
      risks: [],
      evidence: [],
      history: {
        origin: 'import',
        revision: 0,
      },
      compat: {
        accepts: ['tpkg-0.1'],
        downgradeStrategy: 'lossy-allowed',
      },
    };

    const importRes = await request(app)
      .post('/api/v1/task-packages/import')
      .send({ title: 'V2 import', payload: v2Payload });

    expect(importRes.status).toBe(200);
    expect(importRes.body.success).toBe(true);
    const v2PackageId = importRes.body.data.pkg.id;
    expect(v2PackageId).toBeTruthy();
    createdPackageIds.push(v2PackageId);

    const conflictQuestion = 'Please do not change database and also do No runtime code changes.';
    const applyV2Res = await request(app)
      .post(`/api/v1/task-packages/${v2PackageId}/apply`)
      .send({ userQuestion: conflictQuestion, mode: 'constrain' });

    expect(applyV2Res.status).toBe(200);
    expect(applyV2Res.body.success).toBe(true);
    const conflictTypes = applyV2Res.body.data.applyReport.conflicts.map((c: any) => c.type);
    expect(conflictTypes).toContain('CONSTRAINT_VIOLATION');
    expect(conflictTypes).toContain('NONGOAL_REQUEST');
    expect(mockState.getLastSystemPrompt()).toContain('CONSTRAINT_VIOLATION');
    expect(mockState.getLastSystemPrompt()).toContain('NONGOAL_REQUEST');
    expect(mockState.getLastSystemPrompt()).toContain('constraints.technical[0]');
    expect(applyV2Res.body.data.applyReport.findings.liftedFromVersion).toBe('tpkg-0.2');
  });
});
