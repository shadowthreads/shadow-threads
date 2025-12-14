/**
 * LLM 服务 - 统一的 LLM 调用接口（带 DeepSeek 兜底）
 */

import { LLMProvider } from '@prisma/client';
import { logger } from '../utils';
import { Errors } from '../middleware';
import {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMMessage,
} from '../types';

// Provider 实现
import { OpenAIProvider } from '../providers/openai.provider';
import { AnthropicProvider } from '../providers/anthropic.provider';
import { GoogleProvider } from '../providers/google.provider';
import { DeepSeekProvider } from '../providers/deepseek.provider';

export interface ILLMProvider {
  complete(
    messages: LLMMessage[],
    model: string,
    apiKey: string
  ): Promise<LLMCompletionResponse>;
  validateApiKey(apiKey: string): Promise<boolean>;
}

export class LLMService {
  // 注意这里用 string，不再用 LLMProvider 作为 Map 的 key 类型，
  // 这样我们可以安全地塞入 "DEEPSEEK"
  private providers: Map<string, ILLMProvider>;

  constructor() {
    this.providers = new Map();
    this.providers.set('OPENAI', new OpenAIProvider());
    this.providers.set('ANTHROPIC', new AnthropicProvider());
    this.providers.set('GOOGLE', new GoogleProvider());
    this.providers.set('DEEPSEEK', new DeepSeekProvider());
  }

  /**
   * 调用 LLM 完成对话
   * 所有 provider 出错时，统一尝试用 DeepSeek 兜底
   */
  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const { messages, config } = request;
    const { provider, model, apiKey } = config;

    if (!apiKey) {
      throw Errors.apiKeyNotFound();
    }

    const providerInstance = this.providers.get(provider);
    if (!providerInstance) {
      throw Errors.llmError(`Unsupported provider: ${provider}`);
    }

    logger.info('Calling LLM', {
      provider,
      model,
      messageCount: messages.length,
    });

    try {
      const response = await providerInstance.complete(messages, model, apiKey);

      logger.info('LLM response received', {
        provider,
        model,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
      });

      return response;
    } catch (error) {
      logger.error('LLM call failed', {
        provider,
        model,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // ==========================
      // DeepSeek 统一兜底逻辑
      // ==========================

      // 如果原本就是 DeepSeek，就不要再兜底了，直接抛错
      if (provider === ('DEEPSEEK' as LLMProvider)) {
        throw this.toFriendlyError(error, provider, model);
      }

      const deepseekKey = process.env.DEEPSEEK_API_KEY;
      if (!deepseekKey) {
        logger.warn(
          'DeepSeek fallback skipped: no DEEPSEEK_API_KEY in environment'
        );
        throw this.toFriendlyError(error, provider, model);
      }

      const deepseek = this.providers.get('DEEPSEEK');
      if (!deepseek) {
        logger.warn('DeepSeek fallback skipped: provider not registered');
        throw this.toFriendlyError(error, provider, model);
      }

      try {
        logger.info('Falling back to DeepSeek', {
          fromProvider: provider,
          fromModel: model,
        });

        const fallbackResponse = await deepseek.complete(
          messages,
          'deepseek-chat',
          deepseekKey
        );

        logger.info('DeepSeek fallback success', {
          promptTokens: fallbackResponse.promptTokens,
          completionTokens: fallbackResponse.completionTokens,
        });

        // 标记一下真实使用的模型，方便以后在 UI 中显示 “由 DeepSeek 兜底”
        return {
          ...fallbackResponse,
          model: fallbackResponse.model || 'deepseek-chat',
          finishReason: fallbackResponse.finishReason ?? 'fallback-from-' + provider,
        };
      } catch (fallbackError) {
        logger.error('DeepSeek fallback failed', {
          error:
            fallbackError instanceof Error
              ? fallbackError.message
              : 'Unknown error',
        });

        // 兜底也失败了，只能把原始错误转换后抛出
        throw this.toFriendlyError(error, provider, model);
      }
    }
  }

  /**
   * 把底层错误转换为更友好的业务错误
   */
  private toFriendlyError(
    error: unknown,
    provider: LLMProvider | 'DEEPSEEK',
    model: string
  ) {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();

      if (msg.includes('rate limit')) {
        return Errors.llmRateLimit();
      }
      if (msg.includes('invalid') || msg.includes('unauthorized')) {
        return Errors.llmInvalidKey();
      }
    }

    return Errors.llmError(
      error instanceof Error ? error.message : 'LLM call failed',
      { provider, model }
    );
  }

  /**
   * 验证 API Key
   */
  async validateApiKey(
    provider: LLMProvider | 'DEEPSEEK',
    apiKey: string
  ): Promise<boolean> {
    const providerInstance = this.providers.get(provider);
    if (!providerInstance) {
      throw Errors.llmError(`Unsupported provider: ${provider}`);
    }
    return providerInstance.validateApiKey(apiKey);
  }

  /**
   * 获取支持的模型列表（包含 DeepSeek）
   */
  getModels(provider: LLMProvider | 'DEEPSEEK'): string[] {
    // 这里用 Record<string, string[]>，不再强行绑死到 LLMProvider，
    // 避免 TypeScript 因为生成的 enum 没及时更新而报错
    const models: Record<string, string[]> = {
      OPENAI: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      ANTHROPIC: [
        'claude-3-5-sonnet-20241022',
        'claude-3-opus-20240229',
        'claude-3-haiku-20240307',
      ],
      GOOGLE: ['gemini-pro', 'gemini-pro-vision'],
      GROQ: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant'],
      OLLAMA: ['llama3', 'mistral', 'codellama'],
      CUSTOM: [],
      DEEPSEEK: ['deepseek-chat', 'deepseek-reasoner'],
    };

    return models[provider] || [];
  }
}