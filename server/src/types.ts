/**
 * Shadow Threads Server 类型定义（server 端）
 * ✅ 单一类型入口：所有服务/路由统一从这里 import
 * 注意：Node 环境没有 DOM，因此不能使用 HTMLElement
 */

import type { LLMProvider as PrismaLLMProvider, MessageRole } from '@prisma/client';

/**
 * ✅ 统一 LLMProvider：
 * 以前这里自己定义了一套 union，会和 @prisma/client 的 LLMProvider 打架。
 * Prisma 生成的 enum 类型本质也是 string union，因此这里直接 alias 到 Prisma 的类型，兼容性最好。
 */
export type LLMProvider = PrismaLLMProvider;

export type SupportedPlatform =
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'poe'
  | 'unknown';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;

  // server 端不应依赖 DOM
  element?: unknown;

  platform: SupportedPlatform;
}

/**
 * ========= LLM Types (Phase 1 / CLRC instrumentation needs) =========
 * 这些是 llm.service.ts 需要的类型。
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCompletionConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
}

/**
 * LLM 调用请求
 * ✅ route/requestId 是 Phase 1 metrics / CLRC 必需字段（可选，不影响旧调用）
 */
export interface LLMCompletionRequest {
  messages: LLMMessage[];
  config: LLMCompletionConfig;

  // Phase 1 metrics / CLRC instrumentation
  route?: string;
  requestId?: string;
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
 * ========= API DTO / Request Types =========
 */

export interface CreateSubthreadRequest {
  platform: string;
  conversationId: string;
  conversationUrl?: string;
  messageId: string;
  messageRole: string;
  messageText: string;
  selectionText: string;
  selectionStart?: number;
  selectionEnd?: number;
  userQuestion: string;
  provider?: LLMProvider;
  model?: string;
}

export interface ContinueSubthreadRequest {
  userQuestion: string;
  provider?: LLMProvider;
  model?: string;
}

export interface SubthreadMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  createdAt: string;
}

export interface SubthreadResponse {
  subthread: {
    id: string;
    provider: LLMProvider;
    model: string;
    sourceContext: {
      platform: string;
      selectionText: string;
    };
  };
  messages: SubthreadMessage[];
  assistantReply: {
    id: string;
    content: string;
  };
}

/**
 * ✅ 公共 API 响应封装
 * 保持兼容：meta/details 都是 optional
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;

  // 兼容 list 接口已经在返回的 meta
  meta?: unknown;

  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * 子线程消息 DTO（如果 extension/options 也在用）
 */
export interface SubthreadMessageDTO {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string | Date;
}