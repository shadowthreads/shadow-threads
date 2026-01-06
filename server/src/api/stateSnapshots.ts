/**
 * StateSnapshot API 路由
 *
 * 本步骤在做什么：
 * 1) 继续对话：只用 snapshot + userQuestion 续写（不依赖原始 messages）
 * 2) 状态演化：让 snapshot 的 conclusions / assumptions / openQuestions 随使用自动增长
 * 3) 生成谱系：每次 evolve 生成一个“子快照”，写 parentId/rootId/rev，形成 snapshot → snapshot → snapshot
 * 4) 用户可控：新增一个“手动创建 snapshot”的接口（给前端按钮用）
 */

import { Router, Request, Response } from 'express';
import { asyncHandler, requireAuth, validate } from '../middleware';
import { idParamSchema } from '../middleware/validation';
import { prisma } from '../utils';
import { LLMService } from '../services/llm.service';
import { UserService } from '../services/user.service';
import { LLMProvider, Prisma } from '@prisma/client';
import { z } from 'zod';

const router = Router();
const llmService = new LLMService();
const userService = new UserService();

/**
 * continue：回答 + 自动 evolve
 */
const continueFromStateSchema = z.object({
  userQuestion: z.string().min(1).max(10000),
  provider: z.nativeEnum(LLMProvider).optional(),
  model: z.string().optional()
});

/**
 * evolve：只演化（适合补全旧 snapshot）
 */
const evolveOnlySchema = z.object({
  userQuestion: z.string().min(1).max(10000),
  assistantReply: z.string().min(1).max(40000),
  provider: z.nativeEnum(LLMProvider).optional(),
  model: z.string().optional()
});

/**
 * 手动创建 snapshot（给“Create a snapshot here”按钮用）
 * - snapshot: 任意 JSON（建议是 SnapshotV1 结构）
 * - subthreadId: 可选（如果你希望把它挂到某条 subthread 上）
 * - version: 可选，默认 v1
 */
const createSnapshotSchema = z.object({
  snapshot: z.any(),
  subthreadId: z.string().uuid().optional(),
  version: z.string().optional()
});

type SnapshotV1 = {
  anchorIntent?: {
    description?: string;
    openQuestions?: string[];
    lastEvolvedAt?: string;
  };
  effectiveContext?: {
    strategy?: string;
  };
  thoughtTrajectory?: {
    conclusions?: string[];
  };
  continuationContract?: {
    assumptions?: string[];
  };
};

function uniqLimit(arr: string[], limit: number) {
  return Array.from(new Set(arr.map((x) => String(x).trim()).filter(Boolean))).slice(0, limit);
}

function readV1Fields(snapAny: any) {
  const snap = (snapAny || {}) as SnapshotV1;

  const anchorDesc = String(snap?.anchorIntent?.description || '').trim();
  const strategy = String(snap?.effectiveContext?.strategy || 'UNKNOWN').trim();

  const conclusions = Array.isArray(snap?.thoughtTrajectory?.conclusions)
    ? snap.thoughtTrajectory!.conclusions!.map((x) => String(x))
    : [];

  const assumptions = Array.isArray(snap?.continuationContract?.assumptions)
    ? snap.continuationContract!.assumptions!.map((x) => String(x))
    : [];

  // ✅ 兼容你 Prisma Studio 中看到的结构：openQuestions 在 anchorIntent 里
  const openQuestions = Array.isArray(snap?.anchorIntent?.openQuestions)
    ? snap.anchorIntent!.openQuestions!.map((x) => String(x))
    : [];

  return { snap, anchorDesc, strategy, conclusions, assumptions, openQuestions };
}

/**
 * 用 LLM 生成 “delta（要新增的结论/假设/未决问题）”
 * 只允许输出 JSON
 */
async function generateDelta(params: {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  previousSnapshot: any;
  userQuestion: string;
  assistantReply: string;
}) {
  const { provider, model, apiKey, previousSnapshot, userQuestion, assistantReply } = params;

  const evolveSystemPrompt = [
    `你是一个“认知状态更新器（StateSnapshot Evolver）”。`,
    `你只能输出 JSON，不要输出任何解释文字。`,
    `目标：基于 previousSnapshot + userQuestion + assistantReply，产出要“新增”的条目。`,
    ``,
    `输出 JSON 结构必须是：`,
    `{`,
    `  "conclusionsAdd": string[],`,
    `  "assumptionsAdd": string[],`,
    `  "openQuestionsAdd": string[]`,
    `}`,
    ``,
    `硬约束：`,
    `- conclusionsAdd / assumptionsAdd / openQuestionsAdd 每项最多 3 条`,
    `- 每条尽量短（<= 20 字为佳），可执行、可复用`,
    `- 不要复述 assistantReply 原句，做抽象总结`
  ].join('\n');

  const evolveResp = await llmService.complete({
    messages: [
      { role: 'system', content: evolveSystemPrompt },
      { role: 'user', content: JSON.stringify({ previousSnapshot, userQuestion, assistantReply }) }
    ],
    config: { provider, model, apiKey },
    route: 'state_evolve'
  } as any);

  // 容错：有些模型会包 ```json
  const raw = String(evolveResp.content || '').trim();
  const jsonText = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    const delta = JSON.parse(jsonText);
    return {
      conclusionsAdd: Array.isArray(delta?.conclusionsAdd) ? delta.conclusionsAdd : [],
      assumptionsAdd: Array.isArray(delta?.assumptionsAdd) ? delta.assumptionsAdd : [],
      openQuestionsAdd: Array.isArray(delta?.openQuestionsAdd) ? delta.openQuestionsAdd : []
    };
  } catch {
    return { conclusionsAdd: [], assumptionsAdd: [], openQuestionsAdd: [] };
  }
}

/**
 * 生成一个“子版本快照”（谱系）
 */
async function createChildSnapshot(params: {
  userId: string;
  parent: {
    id: string;
    rootId: string | null;
    rev: number | null;
    subthreadId: string | null;
    version: string;
  };
  mergedSnapshot: any;
}) {
  const { userId, parent, mergedSnapshot } = params;

  const rootId = parent.rootId || parent.id;
  const nextRev = (parent.rev ?? 0) + 1;

  const child = await prisma.stateSnapshot.create({
    data: {
      userId,
      subthreadId: parent.subthreadId ?? null,
      snapshot: mergedSnapshot as Prisma.InputJsonValue, // ✅ 修复 JsonValue vs InputJsonValue
      version: parent.version || 'v1',
      rootId,
      parentId: parent.id,
      rev: nextRev
    }
  });

  return child;
}

/**
 * POST /state-snapshots
 * ✅ 用户手动创建 snapshot（按钮用）
 *
 * 本步骤在做什么：
 * - 让“snapshot 的创建”不只由系统控制，也支持用户手动在某个节点保存
 * - 同时把 rootId 初始化为自身 id（用 transaction 两步完成）
 */
router.post(
  '/',
  requireAuth,
  validate({ body: createSnapshotSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.userId!;
    const { snapshot, subthreadId, version } = req.body as any;

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.stateSnapshot.create({
        data: {
          userId,
          subthreadId: subthreadId ?? null,
          snapshot: snapshot as Prisma.InputJsonValue, // ✅ 修复类型
          version: version || 'v1',
          // rootId/parentId/rev 先让 DB 默认值承接
        }
      });

      // ✅ 关键：不要在 update 里再写 snapshot（否则就容易触发 JsonValue 类型冲突）
      return await tx.stateSnapshot.update({
        where: { id: row.id },
        data: { rootId: row.id, rev: 0 }
      });
    });

    res.json({ success: true, data: created });
  })
);

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
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'StateSnapshot not found' } });
      return;
    }

    if (row.userId !== userId) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'StateSnapshot exists but not owned by this user' } });
      return;
    }

    res.json({ success: true, data: row });
  })
);

/**
 * POST /state-snapshots/:id/continue
 * ✅ 只用 snapshot + userQuestion 续写；然后自动 evolve，并生成 child snapshot
 *
 * 本步骤在做什么：
 * - 让 conclusions/assumptions/openQuestions 不再长期为空：每次续写都尝试沉淀 delta 到新 snapshot
 */
router.post(
  '/:id/continue',
  requireAuth,
  validate({ params: idParamSchema, body: continueFromStateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.userId!;
    const { userQuestion, provider: providerWanted, model: modelWanted } = req.body as any;

    const parent = await prisma.stateSnapshot.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        subthreadId: true,
        snapshot: true,
        version: true,
        rootId: true,
        parentId: true,
        rev: true
      }
    });

    if (!parent) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'StateSnapshot not found' } });
      return;
    }

    if (parent.userId !== userId) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'StateSnapshot exists but not owned by this user' } });
      return;
    }

    // === 1) 提取 snapshot（用于回答）===
    const { snap, anchorDesc, strategy, conclusions, assumptions, openQuestions } = readV1Fields(parent.snapshot);

    // === 2) provider / model ===
    const provider: LLMProvider = providerWanted || LLMProvider.OPENAI;
    const model: string = modelWanted || 'gpt-4o-mini';
    const apiKey = await userService.getDecryptedApiKey(userId, provider);

    // === 3) 主回答（snapshot-only）===
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
      `- anchorIntent.openQuestions:`,
      openQuestions.length ? openQuestions.map((q, i) => `  ${i + 1}. ${q}`).join('\n') : `  (none)`,
      ``,
      `【硬约束】`,
      `1) 不要索要原对话或上下文窗口。`,
      `2) 沿着 anchorIntent 推进，而不是重新开始。`,
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

    // === 4) 自动 evolve（delta）+ 生成 child snapshot ===
    let childId: string | null = null;
    let deltaUsed: any = null;

    try {
      const delta = await generateDelta({
        provider,
        model,
        apiKey,
        previousSnapshot: snap,
        userQuestion,
        assistantReply: llmResp.content
      });

      deltaUsed = delta;

      const merged: SnapshotV1 = {
        ...snap,
        anchorIntent: {
          ...(snap.anchorIntent || {}),
          openQuestions: uniqLimit([...(openQuestions || []), ...(delta.openQuestionsAdd || [])], 20),
          lastEvolvedAt: new Date().toISOString()
        },
        thoughtTrajectory: {
          ...(snap.thoughtTrajectory || {}),
          conclusions: uniqLimit([...(conclusions || []), ...(delta.conclusionsAdd || [])], 50)
        },
        continuationContract: {
          ...(snap.continuationContract || {}),
          assumptions: uniqLimit([...(assumptions || []), ...(delta.assumptionsAdd || [])], 50)
        }
      };

      const child = await createChildSnapshot({
        userId,
        parent: {
          id: parent.id,
          rootId: parent.rootId,
          rev: parent.rev,
          subthreadId: parent.subthreadId ?? null,
          version: parent.version || 'v1'
        },
        mergedSnapshot: merged
      });

      childId = child.id;
    } catch {
      // evolve 失败不阻断 continue（主链路优先）
    }

    res.json({
      success: true,
      data: {
        parentStateSnapshotId: parent.id,
        childStateSnapshotId: childId,
        version: parent.version,
        provider,
        model,
        assistantReply: { content: llmResp.content },
        debug: { evolved: Boolean(childId), deltaUsed }
      }
    });
  })
);

/**
 * POST /state-snapshots/:id/evolve
 * ✅ 不回答，仅对“已有一次问答结果”做状态演化，生成 child snapshot
 *
 * 本步骤在做什么：
 * - 给“老 snapshot 补全 conclusions/assumptions/openQuestions”用
 */
router.post(
  '/:id/evolve',
  requireAuth,
  validate({ params: idParamSchema, body: evolveOnlySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.userId!;
    const { userQuestion, assistantReply, provider: providerWanted, model: modelWanted } = req.body as any;

    const parent = await prisma.stateSnapshot.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        subthreadId: true,
        snapshot: true,
        version: true,
        rootId: true,
        parentId: true,
        rev: true
      }
    });

    if (!parent) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'StateSnapshot not found' } });
      return;
    }

    if (parent.userId !== userId) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'StateSnapshot exists but not owned by this user' } });
      return;
    }

    const { snap, conclusions, assumptions, openQuestions } = readV1Fields(parent.snapshot);

    const provider: LLMProvider = providerWanted || LLMProvider.OPENAI;
    const model: string = modelWanted || 'gpt-4o-mini';
    const apiKey = await userService.getDecryptedApiKey(userId, provider);

    const delta = await generateDelta({
      provider,
      model,
      apiKey,
      previousSnapshot: snap,
      userQuestion,
      assistantReply
    });

    const merged: SnapshotV1 = {
      ...snap,
      anchorIntent: {
        ...(snap.anchorIntent || {}),
        openQuestions: uniqLimit([...(openQuestions || []), ...(delta.openQuestionsAdd || [])], 20),
        lastEvolvedAt: new Date().toISOString()
      },
      thoughtTrajectory: {
        ...(snap.thoughtTrajectory || {}),
        conclusions: uniqLimit([...(conclusions || []), ...(delta.conclusionsAdd || [])], 50)
      },
      continuationContract: {
        ...(snap.continuationContract || {}),
        assumptions: uniqLimit([...(assumptions || []), ...(delta.assumptionsAdd || [])], 50)
      }
    };

    const child = await createChildSnapshot({
      userId,
      parent: {
        id: parent.id,
        rootId: parent.rootId,
        rev: parent.rev,
        subthreadId: parent.subthreadId ?? null,
        version: parent.version || 'v1'
      },
      mergedSnapshot: merged
    });

    res.json({
      success: true,
      data: {
        parentStateSnapshotId: parent.id,
        childStateSnapshotId: child.id,
        provider,
        model,
        deltaUsed: delta
      }
    });
  })
);

export default router;