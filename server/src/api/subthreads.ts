/**
 * 子线程 API 路由
 */

import { Router, Request, Response } from 'express';
import {
  asyncHandler,
  requireAuth,
  validate,
  createSubthreadSchema,
  continueSubthreadSchema,
  listSubthreadsQuerySchema,
  idParamSchema,
  CreateSubthreadInput,
  ContinueSubthreadInput,
  ListSubthreadsQuery
} from '../middleware';
import { SubthreadService } from '../services/subthread.service';
import { ApiResponse } from '../types';
import { prisma } from '../utils';

const router = Router();
const subthreadService = new SubthreadService();

// ================================
// Evidence helpers (Pin-time Capture Pack)
// ================================
type EvidenceItem = {
  id: string;
  type: 'selection' | 'context' | 'delta_user' | 'delta_assistant';
  text: string;
  source?: {
    platform?: string;
    conversationId?: string;
    conversationUrl?: string;
    messageId?: string;
    messageRole?: string;
    subthreadId?: string;
    subthreadMessageId?: string;
    createdAt?: string;
  };
  meta?: {
    chunkIndex?: number;
    totalChunks?: number;
    clipped?: boolean;
    charLen?: number;
  };
};

function genEvidenceId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

function chunkText(text: string, chunkSize = 1200) {
  const s = String(text || '');
  const out: string[] = [];
  for (let i = 0; i < s.length; i += chunkSize) out.push(s.slice(i, i + chunkSize));
  return out;
}

function buildEvidencePack(params: {
  subthreadId: string;
  sourceContext: any;
  messages: Array<{ id: string; role: string; content: string; createdAt: Date }>;
}) {
  const { subthreadId, sourceContext, messages } = params;

  const sc = sourceContext || {};
  const selectionText = typeof sc.selectionText === 'string' ? sc.selectionText.trim() : '';
  const contextMessages = Array.isArray(sc.contextMessages) ? sc.contextMessages : [];

  const metaSource = {
    platform: sc.platform,
    conversationId: sc.conversationId,
    conversationUrl: sc.conversationUrl,
    messageId: sc.messageId,
    messageRole: sc.messageRole,
    subthreadId
  };

  const evidence: EvidenceItem[] = [];

  // --- S: selection (chunked) ---
  if (selectionText) {
    const chunks = chunkText(selectionText, 1200);
    chunks.forEach((c, idx) => {
      evidence.push({
        id: genEvidenceId('sel'),
        type: 'selection',
        text: c,
        source: metaSource,
        meta: {
          chunkIndex: idx,
          totalChunks: chunks.length,
          charLen: c.length,
          clipped: chunks.length > 1
        }
      });
    });
  }

  // --- W: contextMessages (keep first 8) ---
  if (contextMessages.length) {
    const sample = contextMessages.slice(0, 8);
    for (let i = 0; i < sample.length; i++) {
      const m = sample[i] || {};
      const t = typeof m.content === 'string' ? m.content.trim() : JSON.stringify(m);
      if (!t) continue;

      evidence.push({
        id: genEvidenceId('ctx'),
        type: 'context',
        text: t,
        source: metaSource,
        meta: { chunkIndex: i, totalChunks: sample.length, charLen: t.length }
      });
    }
  }

  // --- Δ: subthread messages (keep last 6) ---
  const tail = messages.slice(-6);
  for (const m of tail) {
    const role = String(m.role || '').toLowerCase();
    const t = String(m.content || '').trim();
    if (!t) continue;

    evidence.push({
      id: genEvidenceId('d'),
      type: role === 'user' ? 'delta_user' : 'delta_assistant',
      text: t,
      source: {
        ...metaSource,
        subthreadMessageId: m.id,
        createdAt: (m.createdAt as any)?.toISOString?.()
      },
      meta: { charLen: t.length }
    });
  }

  const counts = evidence.reduce(
    (acc, e) => {
      acc.totalChars += e.text.length;
      acc.byType[e.type] = (acc.byType[e.type] || 0) + 1;
      return acc;
    },
    { totalChars: 0, byType: {} as Record<string, number> }
  );

  return { evidence, selectionTextLen: selectionText.length, contextCount: contextMessages.length, deltaCount: messages.length, counts };
}

function qualityGate(evidence: EvidenceItem[]) {
  const totalChars = evidence.reduce((s, e) => s + (e.text?.length || 0), 0);
  const hasSelection = evidence.some((e) => e.type === 'selection' && (e.text?.length || 0) >= 200);

  if (!hasSelection) return { ok: false, reason: 'NO_SELECTION_EVIDENCE', totalChars, hasSelection };
  if (totalChars < 500) return { ok: false, reason: 'EVIDENCE_TOO_THIN', totalChars, hasSelection };
  return { ok: true, reason: 'OK', totalChars, hasSelection };
}

/**
 * 创建新子线程
 * POST /subthreads
 */
router.post(
  '/',
  requireAuth,
  validate({ body: createSubthreadSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = req.body as CreateSubthreadInput;
    const userId = req.userId!;

    const result = await subthreadService.createSubthread(userId, input);

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result
    };

    res.status(201).json(response);
  })
);

/**
 * 获取子线程列表
 * GET /subthreads
 */
router.get(
  '/',
  requireAuth,
  validate({ query: listSubthreadsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as ListSubthreadsQuery;
    const userId = req.userId!;

    const result = await subthreadService.listSubthreads(userId, query);

    const response: ApiResponse<typeof result.subthreads> = {
      success: true,
      data: result.subthreads,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total
      }
    };

    res.json(response);
  })
);

/**
 * 获取单个子线程
 * GET /subthreads/:id
 */
router.get(
  '/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.userId!;

    const subthread = await subthreadService.getSubthread(userId, id);

    const response: ApiResponse<typeof subthread> = {
      success: true,
      data: subthread
    };

    res.json(response);
  })
);

/**
 * 继续子线程对话
 * POST /subthreads/:id/messages
 */
router.post(
  '/:id/messages',
  requireAuth,
  validate({
    params: idParamSchema,
    body: continueSubthreadSchema
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const input = req.body as ContinueSubthreadInput;
    const userId = req.userId!;

    const result = await subthreadService.continueSubthread(userId, id, input);

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result
    };

    res.json(response);
  })
);

router.post(
  '/:id/snapshots',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id: subthreadId } = req.params;
    const userId = req.userId!;

    // 1) 取 subthread（必须包含 sourceContext，用于 S/W/I）
    const subthread = await prisma.subthread.findUnique({
      where: { id: subthreadId },
      select: {
        id: true,
        userId: true,
        provider: true,
        model: true,
        sourceContext: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!subthread) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Subthread not found' } });
      return;
    }

    if (subthread.userId !== userId) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Subthread exists but not owned by this user' } });
      return;
    }

    // 2) 找到该 subthread 最新 snapshot（仍作为 base v1）
    const latest = await prisma.stateSnapshot.findFirst({
      where: { subthreadId, userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, snapshot: true, version: true, createdAt: true }
    });

    if (!latest) {
      res.status(409).json({
        success: false,
        error: {
          code: 'NO_BASE_SNAPSHOT',
          message: 'No snapshot exists for this subthread yet. Please run at least one shadow turn first.'
        }
      });
      return;
    }

    // 3) 取 Δ（subthread messages，用于 delta evidence）
    const messages = await prisma.subthreadMessage.findMany({
      where: { subthreadId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true }
    });

    // 4) 生成 evidence pack（S/W/Δ/I）
    const { evidence, selectionTextLen, contextCount, deltaCount, counts } = buildEvidencePack({
      subthreadId,
      sourceContext: (subthread as any).sourceContext,
      messages: messages as any
    });

    const qg = qualityGate(evidence);
    if (!qg.ok) {
      res.status(400).json({
        success: false,
        error: { code: 'SNAPSHOT_TOO_THIN', message: `pin rejected: ${qg.reason}` },
        debug: { qg, selectionTextLen, contextCount, deltaCount, counts }
      });
      return;
    }

    // 5) 从 latest.snapshot 提取 fingerprint（用于你 UI 校验）
    const snapAny = (latest.snapshot || {}) as any;
    const anchorDesc = String(snapAny?.anchorIntent?.description || '').trim();
    const strategy = String(snapAny?.effectiveContext?.strategy || '').trim();

    // 6) 构造写入 snapshot：保留 base v1，同时写入 snapshotV2.evidence（关键）
    const base = (latest.snapshot || {}) as any;
    const prevV2 = base.snapshotV2 && typeof base.snapshotV2 === 'object' ? base.snapshotV2 : null;

    const intentFromSelection =
      evidence.find((e) => e.type === 'selection')?.text?.slice(0, 400) ||
      anchorDesc ||
      '(pinned)';

    const snapshotV2 = {
      ...(prevV2 || {}),
      version: 'v2',
      intent: prevV2?.intent || intentFromSelection,

      // ✅ 核心：证据层
      evidence,

      // 结构化字段先不强求完整（Phase C 再 Extract）
      facts: Array.isArray(prevV2?.facts) ? prevV2.facts : [],
      assumptions: Array.isArray(prevV2?.assumptions) ? prevV2.assumptions : [],
      decisions: Array.isArray(prevV2?.decisions) ? prevV2.decisions : [],
      openLoops: Array.isArray(prevV2?.openLoops) ? prevV2.openLoops : [],
      interfaces: Array.isArray(prevV2?.interfaces) ? prevV2.interfaces : [],
      risks: Array.isArray(prevV2?.risks) ? prevV2.risks : [],
      retrievalHints: prevV2?.retrievalHints || { keywords: [], entities: [] }
    };

    const snapshotPayload = {
      ...base,
      snapshotV2
    };

    // 7) 创建新的 root snapshot（事务：create -> update rootId=self）
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.stateSnapshot.create({
        data: {
          userId,
          subthreadId,
          snapshot: snapshotPayload as any,
          version: latest.version || 'v1',
          parentId: null,
          rev: 0
        }
      });

      return await tx.stateSnapshot.update({
        where: { id: row.id },
        data: { rootId: row.id }
      });
    });

    res.json({
      success: true,
      data: {
        pinnedStateSnapshotId: created.id,
        rootId: created.rootId,
        parentId: created.parentId,
        rev: created.rev,
        subthreadId,
        version: created.version,

        baseStateSnapshotId: latest.id,
        baseCreatedAt: latest.createdAt,
        baseFingerprint: {
          anchorDescPreview: anchorDesc ? anchorDesc.slice(0, 80) : '',
          strategy
        }
      },
      debug: {
        usedSubthreadId: subthreadId,
        usedBaseSnapshotId: latest.id,
        qg,
        evidencePreview: {
          count: evidence.length,
          byType: counts.byType,
          totalChars: counts.totalChars,
          selectionTextLen,
          contextCount,
          deltaCount,
          selectionPreview: evidence.find((e) => e.type === 'selection')?.text?.slice(0, 200) || ''
        }
      }
    });
  })
);

/**
 * 归档子线程
 * POST /subthreads/:id/archive
 */
router.post(
  '/:id/archive',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.userId!;

    await subthreadService.archiveSubthread(userId, id);

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Subthread archived' }
    };

    res.json(response);
  })
);

/**
 * 删除子线程
 * DELETE /subthreads/:id
 */
router.delete(
  '/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.userId!;

    await subthreadService.deleteSubthread(userId, id);

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Subthread deleted' }
    };

    res.json(response);
  })
);

export default router;