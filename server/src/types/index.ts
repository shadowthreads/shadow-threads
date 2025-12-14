// server/src/types/index.ts

import type { LLMProvider, MessageRole } from '@prisma/client';

/**
 * 用在 LLM 调用里的单条消息
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLM 调用时的配置
 */
export interface LLMCompletionConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
}

/**
 * LLM 调用请求
 */
export interface LLMCompletionRequest {
  messages: LLMMessage[];
  config: LLMCompletionConfig;
}

/**
 * LLM 调用返回
 */
export interface LLMCompletionResponse {
  content: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
}

/**
 * 公共的 API 响应封装（如果你之前已经有，可以保留原来的）
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: Record<string, any>;
}

/**
 * 子线程消息类型（侧边栏那边也在用）
 */
export interface SubthreadMessageDTO {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string | Date;
}