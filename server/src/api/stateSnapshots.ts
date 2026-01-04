/**
 * StateSnapshot API 路由
 * 验证点：只用 snapshot 续写，不依赖 subthread/sourceContext/messages
 */

import { Router, Request, Response } from 'express';
import { asyncHandler, requireAuth, validate } from '../middleware';
import { idParamSchema } from '../middleware/validation';
import { prisma } from '../utils';
import { ApiResponse } from '../types';
import { LLMService } from '../services/llm.service';
import { UserService } from '../services/user.service';
import { LLMProvider } from '@prisma/client';
import { z } from 'zod';

const router = Router();
const llmService = new LLMService();
const userService = new UserService();

const continueFromStateSchema = z.object({
  userQuestion: z.string().min(1).max(10000),
  provider: z.nativeEnum(LLMProvider).optional(),
  model: z.string().optional()
});

/**
 * GET /state-snapshots/:id
 */
router.get(
  '/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.userId!;

    const row = await prisma.stateSnapshot.findUnique({ where: { id } });

    if (!row) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'StateSnapshot not found' }
      });
      return;
    }

    if (row.userId !== userId) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'StateSnapshot exists but not owned by this user' }
      });
      return;
    }

    res.json({ success: true, data: row });
  })
);

/**
 * POST /state-snapshots/:id/continue
 */
router.post(
  '/:id/continue',
  requireAuth,
  validate({ params: idParamSchema, body: continueFromStateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.userId!;
    const { userQuestion, provider: providerWanted, model: modelWanted } = req.body as any;

    const state = await prisma.stateSnapshot.findUnique({
      where: { id },
      select: { id: true, version: true, snapshot: true, userId: true }
    });

    if (!state) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'StateSnapshot not found' }
      });
      return;
    }

    if (state.userId !== userId) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'StateSnapshot exists but not owned by this user' }
      });
      return;
    }

    // === 1) 提取 snapshot ===
    const snap: any = state.snapshot || {};
    const anchorDesc = String(snap?.anchorIntent?.description || '').trim();
    const strategy = String(snap?.effectiveContext?.strategy || 'UNKNOWN').trim();
    const conclusions: string[] = Array.isArray(snap?.thoughtTrajectory?.conclusions)
      ? snap.thoughtTrajectory.conclusions.map(String)
      : [];
    const assumptions: string[] = Array.isArray(snap?.continuationContract?.assumptions)
      ? snap.continuationContract.assumptions.map(String)
      : [];
    const openQuestions: string[] = Array.isArray(snap?.openQuestions)
      ? snap.openQuestions.map(String)
      : [];

    // === 2) provider / model ===
    const provider = providerWanted || LLMProvider.OPENAI;
    const model = modelWanted || 'gpt-4o-mini';
    const apiKey = await userService.getDecryptedApiKey(userId, provider);

    // === 3) 主回答 ===
    const systemPrompt = [
      `你不是在继续一段对话记录，你是在继续一个「思考状态（StateSnapshot）」并回答用户的新问题。`,
      ``,
      `【StateSnapshot 信息】`,
      `- anchorIntent.description: ${anchorDesc || '(empty)'}`,
      `- effectiveContext.strategy: ${strategy}`,
      `- thoughtTrajectory.conclusions:`,
      conclusions.length ? conclusions.map((c, i) => `  ${i + 1}. ${c}`).join('\n') : `  (none)`,
      `- continuationContract.assumptions:`,
      assumptions.length ? assumptions.map((a, i) => `  ${i + 1}. ${a}`).join('\n') : `  (none)`,
      `- openQuestions:`,
      openQuestions.length ? openQuestions.map((q, i) => `  ${i + 1}. ${q}`).join('\n') : `  (none)`,
      ``,
      `【硬约束】`,
      `1) 不要索要原对话或上下文窗口。`,
      `2) 沿着 anchorIntent 推进。`,
      `3) 若信息不足，优先围绕 openQuestions 澄清（最多 3 条）。`,
      ``,
      `请使用用户提问的语言回答。`
    ].join('\n');

    const llmResp = await llmService.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userQuestion }
      ],
      config: { provider, model, apiKey },
      route: 'state_continue'
    } as any);

    // === 4) 状态演进（delta）===
    let delta: any = null;

    try {
      const evolveSystemPrompt = [
        `你是一个认知状态更新器，只输出 JSON。`,
        `{ "conclusionsAdd": [], "assumptionsAdd": [], "openQuestionsAdd": [] }`
      ].join('\n');

      const evolveResp = await llmService.complete({
        messages: [
          { role: 'system', content: evolveSystemPrompt },
          {
            role: 'user',
            content: JSON.stringify({
              previousSnapshot: snap,
              userQuestion,
              assistantReply: llmResp.content
            })
          }
        ],
        config: { provider, model, apiKey },
        route: 'state_evolve'
      } as any);

      delta = JSON.parse(evolveResp.content);
    } catch {}

    if (delta) {
      const merged = {
        ...snap,
        thoughtTrajectory: {
          conclusions: Array.from(new Set([...conclusions, ...(delta.conclusionsAdd || [])])).slice(0, 20)
        },
        continuationContract: {
          assumptions: Array.from(new Set([...assumptions, ...(delta.assumptionsAdd || [])])).slice(0, 20)
        },
        openQuestions: Array.from(new Set([...openQuestions, ...(delta.openQuestionsAdd || [])])).slice(0, 10),
        lastEvolvedAt: new Date().toISOString()
      };

      await prisma.stateSnapshot.update({
        where: { id: state.id },
        data: { snapshot: merged }
      });
    }

    res.json({
      success: true,
      data: {
        stateSnapshotId: state.id,
        version: state.version,
        provider,
        model,
        assistantReply: { content: llmResp.content }
      }
    });
  })
);

export default router;