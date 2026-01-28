/**
 * StateSnapshot Service (industrialized)
 * - create root snapshot with rootId/rev initialization
 * - continue / evolve orchestration moved from API layer
 * - child snapshot idempotency via @@unique([parentId, rev]) + upsert
 */

import { LLMProvider, Prisma } from '@prisma/client';
import { prisma, logger } from '../utils';
import { LLMService } from './llm.service';
import { UserService } from './user.service';
import {
  SnapshotV1,
  SnapshotV2,
  buildV2BaselineFromV1,
  formatEvidenceDigest,
  formatSnapshotV2,
  readV1Fields,
  uniqLimit,
} from './stateSnapshot/snapshot.helpers';

export type StateSnapshotV1 = {
  anchorIntent: {
    description: string;
  };

  effectiveContext: {
    strategy: 'WINDOW_L1' | string;
    summary?: string;
  };

  thoughtTrajectory: {
    conclusions: string[];
    rejected?: string[];
  };

  continuationContract: {
    assumptions: string[];
    instructions?: string[];
  };
};

// 供 API continue/evolve 使用
export type ContinueFromStateInput = {
  userQuestion: string;
  mode?: 'bootstrap' | 'constrain' | 'review';
  provider?: LLMProvider;
  model?: string;
};

export type EvolveOnlyInput = {
  userQuestion: string;
  assistantReply: string;
  provider?: LLMProvider;
  model?: string;
};

export class StateSnapshotService {
  private llmService = new LLMService();
  private userService = new UserService();

  /**
   * root snapshot 创建（给 SubthreadService 旁路落库用）
   * - 工业要求：创建后 rootId = 自己；rev=0
   */
  async createFromSubthread(params: {
    userId: string;
    subthreadId: string;
    snapshot: StateSnapshotV1;
    snapshotV2?: SnapshotV2;
    version?: string;
  }) {
    const { userId, subthreadId, snapshot, snapshotV2, version } = params;

    // v2 作为增量挂载在 snapshot.snapshotV2，不破坏 v1
    const mergedSnapshot: any = snapshotV2 ? { ...snapshot, snapshotV2 } : snapshot;

    return await prisma.$transaction(async (tx) => {
      const row = await tx.stateSnapshot.create({
        data: {
          userId,
          subthreadId,
          snapshot: mergedSnapshot as Prisma.InputJsonValue,
          version: version || 'v1',
          rev: 0,
        },
      });

      // 初始化 rootId = 自身
      return await tx.stateSnapshot.update({
        where: { id: row.id },
        data: { rootId: row.id, rev: 0 },
      });
    });
  }

  /**
   * 手动创建 snapshot（按钮用）
   */
  async createManualSnapshot(params: {
    userId: string;
    snapshot: any;
    subthreadId?: string | null;
    version?: string;
  }) {
    const { userId, snapshot, subthreadId, version } = params;

    return await prisma.$transaction(async (tx) => {
      const row = await tx.stateSnapshot.create({
        data: {
          userId,
          subthreadId: subthreadId ?? null,
          snapshot: snapshot as Prisma.InputJsonValue,
          version: version || 'v1',
          rev: 0,
        },
      });

      return await tx.stateSnapshot.update({
        where: { id: row.id },
        data: { rootId: row.id, rev: 0 },
      });
    });
  }

  /**
   * 读取并校验所有权
   */
  async getOwnedSnapshot(params: { id: string; userId: string }) {
    const { id, userId } = params;
    const row = await prisma.stateSnapshot.findUnique({ where: { id } });
    if (!row) return { ok: false as const, code: 'NOT_FOUND' as const, row: null };
    if (row.userId !== userId) return { ok: false as const, code: 'FORBIDDEN' as const, row: null };
    return { ok: true as const, row };
  }

  /**
   * continue：只用 snapshot + userQuestion 续写；然后自动 evolve，生成 child snapshot
   */
  async continueFromSnapshot(params: { id: string; userId: string; input: ContinueFromStateInput }) {
    const { id, userId, input } = params;
    const mode = (input.mode || 'bootstrap') as 'bootstrap' | 'constrain' | 'review';

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
        rev: true,
      },
    });

    if (!parent) return { ok: false as const, code: 'NOT_FOUND' as const };
    if (parent.userId !== userId) return { ok: false as const, code: 'FORBIDDEN' as const };

    const { snap, anchorDesc, strategy, conclusions, assumptions, openQuestions, snapshotV2 } = readV1Fields(parent.snapshot);
    const ensuredV2 = snapshotV2 || buildV2BaselineFromV1({ anchorDesc: anchorDesc || '', conclusions, assumptions, openQuestions });

    const provider: LLMProvider = input.provider || LLMProvider.OPENAI;
    const model: string = input.model || 'gpt-4o-mini';
    const apiKey = await this.userService.getDecryptedApiKey(userId, provider);

    const modeInstruction =
      mode === 'constrain'
        ? [
            `【Apply Mode: CONSTRAIN】`,
            `- 必须遵守 snapshotV2.assumptions 与 interfaces.constraints`,
            `- 若 userQuestion 与这些约束冲突：先指出冲突，再给出不违背约束的替代方案，然后继续回答`,
          ].join('\n')
        : mode === 'review'
        ? [
            `【Apply Mode: REVIEW】`,
            `- 先检查 userQuestion 是否与 snapshotV2.facts/decisions/assumptions 冲突`,
            `- 列出缺口（缺哪些信息才能可靠回答）`,
            `- 再给出“当前最佳回答 + 明确不确定性”`,
          ].join('\n')
        : [
            `【Apply Mode: BOOTSTRAP】`,
            `- 先用 Snapshot 做项目现状简报（3~6条），必须具体复述 Snapshot 中已存在的事实/决策/约束`,
            `- 不得用“尚未明确/尚未决定/信息不足所以需要背景”来描述 Snapshot 已经给出的内容`,
            `- 再回答 userQuestion`,
            `- 若确有缺口，最多提 3 个澄清问题（优先 openLoops），且每个问题必须说明“缺口会影响什么决策/输出”`,
          ].join('\n');

    const systemPrompt = [
      `你不是在继续一段对话记录，你是在应用一个「信息核心（StateSnapshot）」到新的对话，并回答用户的新问题。`,
      ``,

      `【State Validity Contract】`,
      `以下 Snapshot 信息被视为“已确认的当前事实状态”，不是示例、不是假设、不是待确认材料：`,
      `- 不允许否认或弱化 Snapshot 中已存在的事实/决策/约束`,
      `- 不允许把具体项目降级成抽象描述（例如“我们在探讨一个项目/功能”）`,
      `- 不允许要求用户“重新提供背景/上下文窗口”作为继续的前提`,
      `- 若信息有缺口，只能在该状态基础上提出补充（最多 3 个澄清问题，优先 openLoops）`,
      ``,

      `【SnapshotV1】`,
      `- anchorIntent.description: ${anchorDesc || '(empty)'}`,
      `- effectiveContext.strategy: ${strategy}`,
      `- thoughtTrajectory.conclusions:`,
      conclusions.length ? conclusions.map((c, i) => `  ${i + 1}. ${c}`).join('\n') : `  (none)`,
      `- continuationContract.assumptions:`,
      assumptions.length ? assumptions.map((a, i) => `  ${i + 1}. ${a}`).join('\n') : `  (none)`,
      `- anchorIntent.openQuestions:`,
      openQuestions.length ? openQuestions.map((q, i) => `  ${i + 1}. ${q}`).join('\n') : `  (none)`,
      ``,
      `【SnapshotV2】`,
      formatSnapshotV2(ensuredV2),
      ``,
      formatEvidenceDigest(ensuredV2),
      ``,
      modeInstruction,
      ``,
      `【硬约束】`,
      `1) 不要索要原对话或上下文窗口。`,
      `2) 必须优先使用 Evidence Digest 中的内容作为事实/约束来源（它就是用户实际选中的信息）。`,
      `3) 沿着 Snapshot 推进，而不是重新开始。`,
      `4) 若信息不足，最多提出 3 个澄清问题（优先 openLoops），且必须说明缺口影响什么。`,
      ``,
      `请使用用户提问的语言回答。`,
    ].join('\n');

    const llmResp = await this.llmService.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input.userQuestion },
      ],
      config: { provider, model, apiKey },
      route: 'state_continue',
    } as any);

    // 自动 evolve（失败不阻断）
    let childId: string | null = null;
    let deltaUsed: any = null;

    try {
      const delta = await this.generateDelta({
        provider,
        model,
        apiKey,
        previousSnapshot: snap,
        userQuestion: input.userQuestion,
        assistantReply: llmResp.content,
      });

      deltaUsed = delta;

      const merged: any = {
        ...snap,
        snapshotV2: ensuredV2, // 写回 v2（baseline 或已有）
        anchorIntent: {
          ...(snap as any).anchorIntent,
          openQuestions: uniqLimit([...(openQuestions || []), ...(delta.openQuestionsAdd || [])], 20),
          lastEvolvedAt: new Date().toISOString(),
        },
        thoughtTrajectory: {
          ...(snap as any).thoughtTrajectory,
          conclusions: uniqLimit([...(conclusions || []), ...(delta.conclusionsAdd || [])], 50),
        },
        continuationContract: {
          ...(snap as any).continuationContract,
          assumptions: uniqLimit([...(assumptions || []), ...(delta.assumptionsAdd || [])], 50),
        },
      };

      const child = await this.createChildSnapshotIdempotent({
        userId,
        parent: {
          id: parent.id,
          rootId: parent.rootId,
          rev: parent.rev,
          subthreadId: parent.subthreadId ?? null,
          version: parent.version || 'v1',
        },
        mergedSnapshot: merged,
      });

      childId = child.id;
    } catch (err) {
      logger.warn('[StateSnapshot] evolve failed (continue, ignored)', { err });
    }

    return {
      ok: true as const,
      data: {
        usedSnapshotId: parent.id,
        parentStateSnapshotId: parent.id,
        childStateSnapshotId: childId,
        version: parent.version,
        provider,
        model,
        assistantReply: { content: llmResp.content },
        debug: {
          mode,
          usedEnsuredV2: Boolean(ensuredV2),
          evolved: Boolean(childId),
          deltaUsed,
          snapshotPreview: {
            anchorDescPreview: (anchorDesc || '').slice(0, 240),
            intentPreview: String((ensuredV2 as any)?.intent || '').slice(0, 240),
            evidenceCount: Array.isArray((ensuredV2 as any)?.evidence) ? (ensuredV2 as any).evidence.length : 0,
            factsCount: Array.isArray((ensuredV2 as any)?.facts) ? (ensuredV2 as any).facts.length : 0,
            decisionsCount: Array.isArray((ensuredV2 as any)?.decisions) ? (ensuredV2 as any).decisions.length : 0,
            openLoopsCount: Array.isArray((ensuredV2 as any)?.openLoops) ? (ensuredV2 as any).openLoops.length : 0,
            interfacesCount: Array.isArray((ensuredV2 as any)?.interfaces) ? (ensuredV2 as any).interfaces.length : 0,
          },
          readback: {
            anchorDescLen: (anchorDesc || '').length,
            conclusionsCount: conclusions.length,
            assumptionsCount: assumptions.length,
            openQuestionsCount: openQuestions.length,
            hasSnapshotV2: Boolean(snapshotV2),
          },
        },
      },
    };
  }

  /**
   * evolve：仅演化（给老 snapshot 补全用）
   */
  async evolveSnapshot(params: { id: string; userId: string; input: EvolveOnlyInput }) {
    const { id, userId, input } = params;

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
        rev: true,
      },
    });

    if (!parent) return { ok: false as const, code: 'NOT_FOUND' as const };
    if (parent.userId !== userId) return { ok: false as const, code: 'FORBIDDEN' as const };

    const { snap, anchorDesc, conclusions, assumptions, openQuestions, snapshotV2 } = readV1Fields(parent.snapshot);
    const ensuredV2 = snapshotV2 || buildV2BaselineFromV1({ anchorDesc: anchorDesc || '', conclusions, assumptions, openQuestions });

    const provider: LLMProvider = input.provider || LLMProvider.OPENAI;
    const model: string = input.model || 'gpt-4o-mini';
    const apiKey = await this.userService.getDecryptedApiKey(userId, provider);

    const delta = await this.generateDelta({
      provider,
      model,
      apiKey,
      previousSnapshot: snap,
      userQuestion: input.userQuestion,
      assistantReply: input.assistantReply,
    });

    const merged: any = {
      ...snap,
      snapshotV2: ensuredV2,
      anchorIntent: {
        ...(snap as any).anchorIntent,
        openQuestions: uniqLimit([...(openQuestions || []), ...(delta.openQuestionsAdd || [])], 20),
        lastEvolvedAt: new Date().toISOString(),
      },
      thoughtTrajectory: {
        ...(snap as any).thoughtTrajectory,
        conclusions: uniqLimit([...(conclusions || []), ...(delta.conclusionsAdd || [])], 50),
      },
      continuationContract: {
        ...(snap as any).continuationContract,
        assumptions: uniqLimit([...(assumptions || []), ...(delta.assumptionsAdd || [])], 50),
      },
    };

    const child = await this.createChildSnapshotIdempotent({
      userId,
      parent: {
        id: parent.id,
        rootId: parent.rootId,
        rev: parent.rev,
        subthreadId: parent.subthreadId ?? null,
        version: parent.version || 'v1',
      },
      mergedSnapshot: merged,
    });

    return {
      ok: true as const,
      data: {
        parentStateSnapshotId: parent.id,
        childStateSnapshotId: child.id,
        provider,
        model,
        deltaUsed: delta,
      },
    };
  }

  // ===========================
  // internal: delta + child
  // ===========================

  private async generateDelta(params: {
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
      `- 不要复述 assistantReply 原句，做抽象总结`,
    ].join('\n');

    const evolveResp = await this.llmService.complete({
      messages: [
        { role: 'system', content: evolveSystemPrompt },
        { role: 'user', content: JSON.stringify({ previousSnapshot, userQuestion, assistantReply }) },
      ],
      config: { provider, model, apiKey },
      route: 'state_evolve',
    } as any);

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
        openQuestionsAdd: Array.isArray(delta?.openQuestionsAdd) ? delta.openQuestionsAdd : [],
      };
    } catch {
      return { conclusionsAdd: [], assumptionsAdd: [], openQuestionsAdd: [] };
    }
  }

  private async createChildSnapshotIdempotent(params: {
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

    // ✅ 幂等：同 parentId + rev 只能有一个；upsert 防止重复写入
    return await prisma.stateSnapshot.upsert({
      where: {
        parentId_rev: {
          parentId: parent.id,
          rev: nextRev,
        },
      },
      create: {
        userId,
        subthreadId: parent.subthreadId ?? null,
        snapshot: mergedSnapshot as Prisma.InputJsonValue,
        version: parent.version || 'v1',
        rootId,
        parentId: parent.id,
        rev: nextRev,
      },
      update: {
        // 工业策略：如果已存在，不覆盖 snapshot（避免并发重试互相改写）
        updatedAt: new Date(),
      },
    });
  }
}