/**
 * 子线程业务服务
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
import { PLATFORM_CONFIG, SupportedPlatform } from '../types/platform';

export class SubthreadService {
  private llmService = new LLMService();
  private userService = new UserService();

  /**
   * 创建新子线程
   */
  async createSubthread(userId: string, input: CreateSubthreadInput) {
    logger.info('Creating subthread', { userId, platform: input.platform });

    // 确定使用的 LLM 提供商和模型
    const { provider, model } = await this.resolveProviderAndModel(
      userId,
      input.platform,
      input.provider,
      input.model
    );

    // 获取用户的 API Key（对应当前 provider）
    const apiKey = await this.userService.getDecryptedApiKey(userId, provider);

    // 创建来源上下文和子线程
    const subthread = await prisma.$transaction(async (tx) => {
      // 创建来源上下文
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
        },
      });

      // 创建子线程
      const subthread = await tx.subthread.create({
        data: {
          userId,
          sourceContextId: sourceContext.id,
          provider,
          model,
          status: SubthreadStatus.ACTIVE,
          messageCount: 0,
        },
        include: {
          sourceContext: true,
        },
      });

      return subthread;
    });

    // 构建系统提示词
    const systemPrompt = this.buildSystemPrompt(
      input.selectionText,
      input.messageText
    );

    // 调用 LLM（带 DeepSeek 兜底 key）
    const llmResponse = await this.llmService.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input.userQuestion },
      ],
      config: {
        provider,
        model,
        apiKey,
        // 兜底使用的 DeepSeek Key（从环境变量读）
        deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
      } as any,
    });

    // 保存消息
    const [userMessage, assistantMessage] = await prisma.$transaction([
      // 用户消息
      prisma.subthreadMessage.create({
        data: {
          subthreadId: subthread.id,
          role: MessageRole.USER,
          content: input.userQuestion,
        },
      }),
      // 助手回复
      prisma.subthreadMessage.create({
        data: {
          subthreadId: subthread.id,
          role: MessageRole.ASSISTANT,
          content: llmResponse.content,
          model: llmResponse.model,
          promptTokens: llmResponse.promptTokens,
          completionTokens: llmResponse.completionTokens,
          finishReason: llmResponse.finishReason,
        },
      }),
      // 更新子线程统计
      prisma.subthread.update({
        where: { id: subthread.id },
        data: {
          messageCount: 2,
          tokenCount:
            (llmResponse.promptTokens || 0) +
            (llmResponse.completionTokens || 0),
        },
      }),
    ]);

    logger.info('Subthread created', {
      subthreadId: subthread.id,
      provider,
      model,
    });

    return {
      subthread: {
        id: subthread.id,
        provider,
        model,
        sourceContext: {
          platform: input.platform,
          selectionText: input.selectionText.slice(0, 200),
        },
      },
      messages: [
        {
          id: userMessage.id,
          role: userMessage.role,
          content: userMessage.content,
          createdAt: userMessage.createdAt,
        },
        {
          id: assistantMessage.id,
          role: assistantMessage.role,
          content: assistantMessage.content,
          createdAt: assistantMessage.createdAt,
        },
      ],
      assistantReply: {
        id: assistantMessage.id,
        content: assistantMessage.content,
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
    // 获取子线程
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
          take: 20, // 最近 20 条消息
        },
      },
    });

    if (!subthread) {
      throw Errors.subthreadNotFound();
    }

    // 确定 provider 和 model（可以临时切换）
    const provider = input.provider || subthread.provider;
    const model = input.model || subthread.model;

    // 获取 API Key
    const apiKey = await this.userService.getDecryptedApiKey(userId, provider);

    // 构建消息历史
    const systemPrompt = this.buildSystemPrompt(
      subthread.sourceContext.selectionText,
      subthread.sourceContext.messageText
    );

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...subthread.messages.map((m) => ({
        role: m.role.toLowerCase() as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: input.userQuestion },
    ];

    // 调用 LLM（同样带上 DeepSeek 兜底 key）
    const llmResponse = await this.llmService.complete({
      messages,
      config: {
        provider,
        model,
        apiKey,
        deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
      } as any,
    });

    // 保存消息
    const [userMessage, assistantMessage] = await prisma.$transaction([
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
        },
      }),
      prisma.subthread.update({
        where: { id: subthreadId },
        data: {
          messageCount: { increment: 2 },
          tokenCount: {
            increment:
              (llmResponse.promptTokens || 0) +
              (llmResponse.completionTokens || 0),
          },
          updatedAt: new Date(),
        },
      }),
    ]);

    return {
      messages: [
        {
          id: userMessage.id,
          role: userMessage.role,
          content: userMessage.content,
          createdAt: userMessage.createdAt,
        },
        {
          id: assistantMessage.id,
          role: assistantMessage.role,
          content: assistantMessage.content,
          createdAt: assistantMessage.createdAt,
        },
      ],
      assistantReply: {
        id: assistantMessage.id,
        content: assistantMessage.content,
      },
    };
  }

  /**
   * 获取子线程列表
   */
  async listSubthreads(userId: string, query: ListSubthreadsQuery) {
    const { page, pageSize, platform, status, search } = query;
    const skip = (page - 1) * pageSize;

    const where = {
      userId,
      status: status || SubthreadStatus.ACTIVE,
      ...(platform && {
        sourceContext: { platform },
      }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' as const } },
          {
            sourceContext: {
              selectionText: {
                contains: search,
                mode: 'insensitive' as const,
              },
            },
          },
        ],
      }),
    };

    const [subthreads, total] = await prisma.$transaction([
      prisma.subthread.findMany({
        where,
        include: {
          sourceContext: {
            select: {
              platform: true,
              selectionText: true,
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

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 解析要使用的 provider 和 model
   */
  private async resolveProviderAndModel(
    userId: string,
    platform: string,
    requestProvider?: LLMProvider,
    requestModel?: string
  ): Promise<{ provider: LLMProvider; model: string }> {
    // 如果请求指定了，直接使用
    if (requestProvider && requestModel) {
      return { provider: requestProvider, model: requestModel };
    }

    // 从平台配置获取默认值
    const platformKey = platform as SupportedPlatform;
    const platformConfig =
      PLATFORM_CONFIG[platformKey] || PLATFORM_CONFIG.unknown;

    // 获取用户设置
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
    });

    const provider =
      requestProvider ||
      settings?.defaultProvider ||
      (platformConfig.provider as LLMProvider);

    const model = requestModel || platformConfig.defaultModel;

    return { provider, model };
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(
    selectionText: string,
    fullMessageText: string
  ): string {
    return `你是一个智能助手，正在帮助用户深入探讨一个话题。

用户正在阅读一段 AI 对话，并选中了其中的一部分内容想要进一步了解。

## 用户选中的内容
${selectionText}

## 完整的原始回答（供参考）
${fullMessageText.slice(0, 3000)}${
      fullMessageText.length > 3000 ? '\n...(内容过长已截断)' : ''
    }

## 你的任务
- 针对用户选中的内容回答问题
- 提供深入、准确、有帮助的信息
- 如果用户的问题涉及原始回答中的其他部分，也可以参考
- 保持回答简洁但全面

请用用户的语言回答（如果选中内容是中文就用中文，英文就用英文）。`;
  }
}