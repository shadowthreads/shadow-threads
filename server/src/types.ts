/**
 * Shadow Threads 类型定义
 */

export interface SubthreadMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: number;
}

export interface Subthread {
  id: string;
  platform: string;          // "chatgpt"
  conversationId: string;    // 来自前端的会话 id
  messageId: string;         // 主对话中那条回答的 id
  selectionText: string;     // 用户选中的文本
  messageText: string;       // 整条回答文本
  createdAt: number;
  updatedAt: number;
  staticContext: {
    userQuestionSummary?: string | null;
    assistantMessageSnippet: string;
  };
  messages: SubthreadMessage[];
  summary?: string;
}

export interface AskRequest {
  subthreadId?: string;
  platform: string;
  conversationId: string;
  messageId: string;
  selectionText: string;
  messageText: string;
  userQuestion: string;
}

export interface AskResponse {
  subthread: Subthread;
  assistantReply: SubthreadMessage;
}
// === LLM 调用相关类型 ===

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
 * （如果你还没有这个，可以顺便加上，供别处复用）
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
 * 子线程消息 DTO（sidebar 那边用到的话可以用这个）
 */
export interface SubthreadMessageDTO {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string | Date;
}