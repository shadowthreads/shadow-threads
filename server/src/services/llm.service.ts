/**
 * LLM 服务 - 统一的 LLM 调用接口（带 DeepSeek 兜底）
 * Phase 1 (CLRC) Instrumentation: JSONL metrics
 */

import { LLMProvider } from '@prisma/client';
import { logger } from '../utils';
import { Errors } from '../middleware';
import {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMMessage
} from '../types';

import { appendLLMMetric } from '../utils/metricsJsonl';

// Provider 实现
import { OpenAIProvider } from '../providers/openai.provider';
import { AnthropicProvider } from '../providers/anthropic.provider';
import { GoogleProvider } from '../providers/google.provider';
import { DeepSeekProvider } from '../providers/deepseek.provider';

export interface ILLMProvider {
  complete(messages: LLMMessage[], model: string, apiKey: string): Promise<LLMCompletionResponse>;
  validateApiKey(apiKey: string): Promise<boolean>;
}

export class LLMService {
  /**
   * 注意：这里用 string 作为 Map key，保持你现有实现（含 DEEPSEEK）
   * Phase 1 先不重构类型边界，避免影响主线。
   */
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

    const startedAt = Date.now();
    const route = (request as any).route || 'unknown';
    const requestId = (request as any).requestId;

    const requestedProvider = provider;
    const requestedModel = model;

    if (!apiKey) {
      // 这类错误也应该可观测（但不会走到 provider 调用）
      appendLLMMetric({
        ts: new Date().toISOString(),
        route,
        requestId,
        providerRequested: String(requestedProvider),
        modelRequested: requestedModel,
        providerExecuted: String(provider),
        modelExecuted: model,
        latencyMs: Date.now() - startedAt,
        success: false,
        usedFallback: false,
        errorClass: 'auth',
        errorMessage: 'API key not found'
      });
      throw Errors.apiKeyNotFound();
    }

    const providerInstance = this.providers.get(provider as any);
    if (!providerInstance) {
      appendLLMMetric({
        ts: new Date().toISOString(),
        route,
        requestId,
        providerRequested: String(requestedProvider),
        modelRequested: requestedModel,
        providerExecuted: String(provider),
        modelExecuted: model,
        latencyMs: Date.now() - startedAt,
        success: false,
        usedFallback: false,
        errorClass: 'bad_request',
        errorMessage: `Unsupported provider: ${provider}`
      });
      throw Errors.llmError(`Unsupported provider: ${provider}`);
    }

    logger.info('Calling LLM', {
      provider,
      model,
      messageCount: messages.length
    });

    // ====== 1) Primary call ======
    try {
      const response = await providerInstance.complete(messages, model, apiKey);

      logger.info('LLM response received', {
        provider,
        model,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens
      });

      // ✅ 记录成功指标（primary success）
      appendLLMMetric({
        ts: new Date().toISOString(),
        route,
        requestId,
        providerRequested: String(requestedProvider),
        modelRequested: requestedModel,
        providerExecuted: String(provider),
        modelExecuted: response.model || model,
        latencyMs: Date.now() - startedAt,
        success: true,
        usedFallback: false,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        finishReason: response.finishReason
      });

      return response;
    } catch (error) {
      logger.error('LLM call failed', {
        provider,
        model,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // ✅ 记录失败指标（primary fail）
      appendLLMMetric({
        ts: new Date().toISOString(),
        route,
        requestId,
        providerRequested: String(requestedProvider),
        modelRequested: requestedModel,
        providerExecuted: String(provider),
        modelExecuted: model,
        latencyMs: Date.now() - startedAt,
        success: false,
        usedFallback: true, // 我们将尝试 fallback（若后续因条件不满足而不 fallback，会再写一条）
        fallbackFromProvider: String(provider),
        errorClass: classifyError(error),
        errorMessage: String((error as any)?.message || error || 'Unknown error')
      });

      // ==========================
      // DeepSeek 统一兜底逻辑
      // ==========================

      // 如果原本就是 DeepSeek，就不要再兜底了，直接抛错
      if (String(provider) === 'DEEPSEEK') {
        throw this.toFriendlyError(error, provider as any, model);
      }

      const deepseekKey = process.env.DEEPSEEK_API_KEY;
      if (!deepseekKey) {
        logger.warn('DeepSeek fallback skipped: no DEEPSEEK_API_KEY in environment');

        // ✅ 记录：没有条件 fallback（依然是一次失败结论）
        appendLLMMetric({
          ts: new Date().toISOString(),
          route,
          requestId,
          providerRequested: String(requestedProvider),
          modelRequested: requestedModel,
          providerExecuted: String(provider),
          modelExecuted: model,
          latencyMs: Date.now() - startedAt,
          success: false,
          usedFallback: false,
          errorClass: 'auth',
          errorMessage: 'DeepSeek fallback skipped: missing DEEPSEEK_API_KEY'
        });

        throw this.toFriendlyError(error, provider as any, model);
      }

      const deepseek = this.providers.get('DEEPSEEK');
      if (!deepseek) {
        logger.warn('DeepSeek fallback skipped: provider not registered');

        appendLLMMetric({
          ts: new Date().toISOString(),
          route,
          requestId,
          providerRequested: String(requestedProvider),
          modelRequested: requestedModel,
          providerExecuted: String(provider),
          modelExecuted: model,
          latencyMs: Date.now() - startedAt,
          success: false,
          usedFallback: false,
          errorClass: 'server',
          errorMessage: 'DeepSeek fallback skipped: provider not registered'
        });

        throw this.toFriendlyError(error, provider as any, model);
      }

      // ====== 2) Fallback call ======
      try {
        logger.info('Falling back to DeepSeek', {
          fromProvider: provider,
          fromModel: model
        });

        const deepseekModel = 'deepseek-chat';
        const fallbackResponse = await deepseek.complete(messages, deepseekModel, deepseekKey);

        logger.info('DeepSeek fallback success', {
          promptTokens: fallbackResponse.promptTokens,
          completionTokens: fallbackResponse.completionTokens
        });

        // ✅ 记录 fallback 成功指标
        appendLLMMetric({
          ts: new Date().toISOString(),
          route,
          requestId,
          providerRequested: String(requestedProvider),
          modelRequested: requestedModel,
          providerExecuted: 'DEEPSEEK',
          modelExecuted: fallbackResponse.model || deepseekModel,
          latencyMs: Date.now() - startedAt,
          success: true,
          usedFallback: true,
          fallbackFromProvider: String(provider),
          promptTokens: fallbackResponse.promptTokens,
          completionTokens: fallbackResponse.completionTokens,
          finishReason: fallbackResponse.finishReason ?? `fallback-from-${provider}`
        });

        // 标记真实使用的模型，方便 UI 显示 “由 DeepSeek 兜底”
        return {
          ...fallbackResponse,
          model: fallbackResponse.model || deepseekModel,
          finishReason: fallbackResponse.finishReason ?? 'fallback-from-' + provider
        };
      } catch (fallbackError) {
        logger.error('DeepSeek fallback failed', {
          error: fallbackError instanceof Error ? fallbackError.message : 'Unknown error'
        });

        // ✅ 记录 fallback 失败指标（最终失败）
        appendLLMMetric({
          ts: new Date().toISOString(),
          route,
          requestId,
          providerRequested: String(requestedProvider),
          modelRequested: requestedModel,
          providerExecuted: 'DEEPSEEK',
          modelExecuted: 'deepseek-chat',
          latencyMs: Date.now() - startedAt,
          success: false,
          usedFallback: true,
          fallbackFromProvider: String(provider),
          errorClass: classifyError(fallbackError),
          errorMessage: String((fallbackError as any)?.message || fallbackError || 'Unknown fallback error')
        });

        // 兜底也失败了：抛原始错误（转友好）
        throw this.toFriendlyError(error, provider as any, model);
      }
    }
  }

  /**
   * 把底层错误转换为更友好的业务错误
   */
  private toFriendlyError(error: unknown, provider: LLMProvider | 'DEEPSEEK', model: string) {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();

      if (msg.includes('rate limit')) {
        return Errors.llmRateLimit();
      }
      if (msg.includes('invalid') || msg.includes('unauthorized')) {
        return Errors.llmInvalidKey();
      }
    }

    return Errors.llmError(error instanceof Error ? error.message : 'LLM call failed', { provider, model });
  }

  /**
   * 验证 API Key
   */
  async validateApiKey(provider: LLMProvider | 'DEEPSEEK', apiKey: string): Promise<boolean> {
    const providerInstance = this.providers.get(provider as any);
    if (!providerInstance) {
      throw Errors.llmError(`Unsupported provider: ${provider}`);
    }
    return providerInstance.validateApiKey(apiKey);
  }

  /**
   * 获取支持的模型列表（包含 DeepSeek）
   */
  getModels(provider: LLMProvider | 'DEEPSEEK'): string[] {
    const models: Record<string, string[]> = {
      OPENAI: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      ANTHROPIC: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
      GOOGLE: ['gemini-pro', 'gemini-pro-vision'],
      GROQ: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant'],
      OLLAMA: ['llama3', 'mistral', 'codellama'],
      CUSTOM: [],
      DEEPSEEK: ['deepseek-chat', 'deepseek-reasoner']
    };

    return models[String(provider)] || [];
  }
}

/**
 * Phase 1：错误分类（用于 metrics / CLRC state）
 */
function classifyError(
  err: any
): 'timeout' | 'rate_limit' | 'auth' | 'bad_request' | 'server' | 'network' | 'unknown' {
  const msg = String(err?.message || err || '').toLowerCase();
  const status = err?.status || err?.response?.status;

  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
  if (status === 429 || msg.includes('rate limit')) return 'rate_limit';
  if (status === 401 || status === 403 || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('api key'))
    return 'auth';
  if (status === 400) return 'bad_request';
  if (status >= 500) return 'server';
  if (msg.includes('econnreset') || msg.includes('enotfound') || msg.includes('network')) return 'network';
  return 'unknown';
}