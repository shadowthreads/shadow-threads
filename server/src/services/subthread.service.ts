/**
 * 子线程业务服务
 * PR-B2: Context L1 meta 落库（SourceContext.contextMeta）
 */

import { LLMProvider, MessageRole, SubthreadStatus } from '@prisma/client';
import { prisma, logger } from '../utils';
import {
  Errors,
  CreateSubthreadInput,
  ContinueSubthreadInput,
  ListSubthreadsQuery,
} from '../middleware';
import { LLMService } from './llm.service';
import { UserService } from './user.service';

type ContextMetaL1 = {
  strategy: 'WINDOW_L1';
  aboveTarget: number;
  belowTarget: number;
  aboveCount: number;
  belowCount: number;
  clipped: boolean;
  clipReason?: 'BUDGET' | 'UNAVAILABLE' | 'OTHER';
  tokenEstimate?: number;
  anchor: {
    conversationId: string;
    messageId: string;
    messageRole?: string;
  };
};

type LLMMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

function mapPrismaRoleToLLMRole(role: MessageRole): 'system' | 'user' | 'assistant' {
  switch (role) {
    case MessageRole.SYSTEM:
      return 'system';
    case MessageRole.USER:
      return 'user';
    case MessageRole.ASSISTANT:
      return 'assistant';
    default:
      // 兜底（理论上不会进来）
      return 'user';
  }
}

export class SubthreadService {
  private llmService = new LLMService();
  private userService = new UserService();

  /**
   * 创建新子线程
   */
  async createSubthread(userId: string, input: CreateSubthreadInput) {
    logger.info('Creating subthread', { userId, platform: input.platform });

    // 1) 解析 provider/model（PR-B2 不改变决策逻辑：只做最小可用兜底）
    const { provider, model } = await this.resolveProviderAndModel(
      userId,
      input.provider,
      input.model
    );

    // 2) 获取用户 API Key
    const apiKey = await this.userService.getDecryptedApiKey(userId, provider);

    // 3) PR-B2：构造 contextMeta（先只记录元信息，不接入 prompt）
    const contextMeta: ContextMetaL1 = {
      strategy: 'WINDOW_L1',
      aboveTarget: 8,
      belowTarget: 0,
      aboveCount: 0,
      belowCount: 0,
      clipped: true,
      clipReason: 'UNAVAILABLE',
      anchor: {
        conversationId: input.conversationId,
        messageId: input.messageId,
        messageRole: input.messageRole,
      },
    };

    // 4) 事务内落库 SourceContext + Subthread
    const created = await prisma.$transaction(async (tx) => {
      const sourceContext = await tx.sourceContext.create({
        data: {
          platform: input.platform,
          conversationId: input.conversationId,
          conversationUrl: input.conversationUrl,
          messageId: input.messageId,
          messageRole: input.messageRole,
          messageText: input.messageText,
          selectionText: input.selectionText,
          selectionStart: input.selectionStart,
          selectionEnd: input.selectionEnd,
          contextMeta, // ✅ PR-B2
        },
      });

      const subthread = await tx.subthread.create({
        data: {
          userId,
          sourceContextId: sourceContext.id,
          provider,
          model,
          status: SubthreadStatus.ACTIVE,
          messageCount: 0,
          tokenCount: 0,
        },
        include: {
          sourceContext: true,
        },
      });

      return { sourceContext, subthread };
    });

    // 5) 调用 LLM（注意：llm.service.ts 内部已有 DeepSeek 兜底）
    const systemPrompt = this.buildSystemPrompt(input.selectionText, input.messageText);

    const llmResponse = await this.llmService.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input.userQuestion },
      ],
      config: {
        provider,
        model,
        apiKey,
      },
    });

    const tokenEstimate =
      (llmResponse.promptTokens || 0) + (llmResponse.completionTokens || 0);

    // 6) 更新 contextMeta.tokenEstimate（失败不阻断主链路）
    try {
      await prisma.sourceContext.update({
        where: { id: created.sourceContext.id },
        data: {
          contextMeta: {
            ...(created.sourceContext.contextMeta as any),
            tokenEstimate,
          },
        },
      });
    } catch (e) {
      logger.warn('Failed to update contextMeta tokenEstimate', {
        sourceContextId: created.sourceContext.id,
      });
    }

    // 7) 保存消息 + 更新统计
    const [userMsg, assistantMsg] = await prisma.$transaction([
      prisma.subthreadMessage.create({
        data: {
          subthreadId: created.subthread.id,
          role: MessageRole.USER,
          content: input.userQuestion,
        },
      }),
      prisma.subthreadMessage.create({
        data: {
          subthreadId: created.subthread.id,
          role: MessageRole.ASSISTANT,
          content: llmResponse.content,
          model: llmResponse.model,
          promptTokens: llmResponse.promptTokens,
          completionTokens: llmResponse.completionTokens,
          finishReason: llmResponse.finishReason,
          error: llmResponse.error || null,
        },
      }),
      prisma.subthread.update({
        where: { id: created.subthread.id },
        data: {
          messageCount: 2,
          tokenCount: tokenEstimate,
          updatedAt: new Date(),
        },
      }),
    ]);

    logger.info('Subthread created', {
      subthreadId: created.subthread.id,
      provider,
      model,
    });

    // 8) 返回给路由层的数据（保持兼容：结构不做破坏性变更）
    return {
      subthread: {
        id: created.subthread.id,
        provider,
        model,
        sourceContext: {
          platform: input.platform,
          selectionText: input.selectionText.slice(0, 200),
          contextMeta: {
            ...contextMeta,
            tokenEstimate,
          },
        },
      },
      messages: [
        {
          id: userMsg.id,
          role: userMsg.role,
          content: userMsg.content,
          createdAt: userMsg.createdAt,
        },
        {
          id: assistantMsg.id,
          role: assistantMsg.role,
          content: assistantMsg.content,
          createdAt: assistantMsg.createdAt,
        },
      ],
      assistantReply: {
        id: assistantMsg.id,
        content: assistantMsg.content,
      },
    };
  }

  /**
   * 继续子线程对话
   */
  async continueSubthread(
    userId: string,
    subthreadId: string,
    input: ContinueSubthreadInput
  ) {
    const subthread = await prisma.subthread.findFirst({
      where: {
        id: subthreadId,
        userId,
        status: SubthreadStatus.ACTIVE,
      },
      include: {
        sourceContext: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 50,
        },
      },
    });

    if (!subthread) {
      throw Errors.subthreadNotFound();
    }

    const provider = input.provider || subthread.provider;
    const model = input.model || subthread.model;

    const apiKey = await this.userService.getDecryptedApiKey(userId, provider);

    const systemPrompt = this.buildSystemPrompt(
      subthread.sourceContext.selectionText,
      subthread.sourceContext.messageText
    );

    const history: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...subthread.messages.map((m) => ({
        role: mapPrismaRoleToLLMRole(m.role),
        content: m.content,
      })),
      { role: 'user', content: input.userQuestion },
    ];

    const llmResponse = await this.llmService.complete({
      messages: history,
      config: {
        provider,
        model,
        apiKey,
      },
    });

    const tokenDelta =
      (llmResponse.promptTokens || 0) + (llmResponse.completionTokens || 0);

    const [userMsg, assistantMsg] = await prisma.$transaction([
      prisma.subthreadMessage.create({
        data: {
          subthreadId,
          role: MessageRole.USER,
          content: input.userQuestion,
        },
      }),
      prisma.subthreadMessage.create({
        data: {
          subthreadId,
          role: MessageRole.ASSISTANT,
          content: llmResponse.content,
          model: llmResponse.model,
          promptTokens: llmResponse.promptTokens,
          completionTokens: llmResponse.completionTokens,
          finishReason: llmResponse.finishReason,
          error: llmResponse.error || null,
        },
      }),
      prisma.subthread.update({
        where: { id: subthreadId },
        data: {
          messageCount: { increment: 2 },
          tokenCount: { increment: tokenDelta },
          updatedAt: new Date(),
        },
      }),
    ]);

    return {
      messages: [
        {
          id: userMsg.id,
          role: userMsg.role,
          content: userMsg.content,
          createdAt: userMsg.createdAt,
        },
        {
          id: assistantMsg.id,
          role: assistantMsg.role,
          content: assistantMsg.content,
          createdAt: assistantMsg.createdAt,
        },
      ],
      assistantReply: {
        id: assistantMsg.id,
        content: assistantMsg.content,
      },
    };
  }

  /**
   * 获取子线程列表
   */
  async listSubthreads(userId: string, query: ListSubthreadsQuery) {
    const { page, pageSize, platform, status, search } = query;
    const skip = (page - 1) * pageSize;

    const where: any = {
      userId,
      status: status || SubthreadStatus.ACTIVE,
    };

    if (platform) {
      where.sourceContext = { platform };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        {
          sourceContext: {
            selectionText: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    const [subthreads, total] = await prisma.$transaction([
      prisma.subthread.findMany({
        where,
        include: {
          sourceContext: {
            select: {
              platform: true,
              selectionText: true,
              contextMeta: true, // ✅ PR-B2：列表可见
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              content: true,
              createdAt: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.subthread.count({ where }),
    ]);

    return {
      subthreads: subthreads.map((s) => ({
        id: s.id,
        title: s.title,
        provider: s.provider,
        model: s.model,
        status: s.status,
        messageCount: s.messageCount,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        sourceContext: {
          platform: s.sourceContext.platform,
          selectionText: s.sourceContext.selectionText.slice(0, 100),
          contextMeta: s.sourceContext.contextMeta ?? null,
        },
        lastMessage: s.messages[0]
          ? {
              content: s.messages[0].content.slice(0, 100),
              createdAt: s.messages[0].createdAt,
            }
          : null,
      })),
      total,
    };
  }

  /**
   * 获取单个子线程详情
   */
  async getSubthread(userId: string, subthreadId: string) {
    const subthread = await prisma.subthread.findFirst({
      where: { id: subthreadId, userId },
      include: {
        sourceContext: true,
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!subthread) {
      throw Errors.subthreadNotFound();
    }

    return {
      id: subthread.id,
      title: subthread.title,
      provider: subthread.provider,
      model: subthread.model,
      status: subthread.status,
      messageCount: subthread.messageCount,
      tokenCount: subthread.tokenCount,
      createdAt: subthread.createdAt,
      updatedAt: subthread.updatedAt,
      sourceContext: {
        platform: subthread.sourceContext.platform,
        conversationId: subthread.sourceContext.conversationId,
        conversationUrl: subthread.sourceContext.conversationUrl,
        messageText: subthread.sourceContext.messageText,
        selectionText: subthread.sourceContext.selectionText,
        selectionStart: subthread.sourceContext.selectionStart,
        selectionEnd: subthread.sourceContext.selectionEnd,
        contextMeta: subthread.sourceContext.contextMeta ?? null, // ✅ PR-B2
      },
      messages: subthread.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    };
  }

  /**
   * 归档子线程
   */
  async archiveSubthread(userId: string, subthreadId: string) {
    const result = await prisma.subthread.updateMany({
      where: { id: subthreadId, userId },
      data: { status: SubthreadStatus.ARCHIVED },
    });

    if (result.count === 0) {
      throw Errors.subthreadNotFound();
    }
  }

  /**
   * 删除子线程
   */
  async deleteSubthread(userId: string, subthreadId: string) {
    const result = await prisma.subthread.updateMany({
      where: { id: subthreadId, userId },
      data: { status: SubthreadStatus.DELETED },
    });

    if (result.count === 0) {
      throw Errors.subthreadNotFound();
    }
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private async resolveProviderAndModel(
    userId: string,
    requestProvider?: LLMProvider,
    requestModel?: string
  ): Promise<{ provider: LLMProvider; model: string }> {
    // 显式指定：优先
    if (requestProvider && requestModel) {
      return { provider: requestProvider, model: requestModel };
    }

    // 用户设置：次优先
    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    const provider = requestProvider || settings?.defaultProvider || LLMProvider.OPENAI;

    // model：若没指定，用一个安全默认
    const model = requestModel || 'gpt-4o-mini';

    return { provider, model };
  }

  private buildSystemPrompt(selectionText: string, fullMessageText: string): string {
    const truncated = fullMessageText.slice(0, 3000);
    const tail = fullMessageText.length > 3000 ? '\n...(内容过长已截断)' : '';

    return `你是一个智能助手，正在帮助用户深入探讨一个话题。

用户正在阅读一段 AI 对话，并选中了其中的一部分内容想要进一步了解。

## 用户选中的内容
${selectionText}

## 完整的原始回答（供参考）
${truncated}${tail}

## 你的任务
- 针对用户选中的内容回答问题
- 提供深入、准确、有帮助的信息
- 如果用户的问题涉及原始回答中的其他部分，也可以参考
- 保持回答简洁但全面

请用用户的语言回答（如果选中内容是中文就用中文，英文就用英文）。`;
  }
}