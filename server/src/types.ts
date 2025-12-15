/**
 * Shadow Threads Server 类型定义（server 端）
 * 注意：Node 环境没有 DOM，因此不能使用 HTMLElement
 */

export type SupportedPlatform =
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'poe'
  | 'unknown';

export type LLMProvider =
  | 'OPENAI'
  | 'ANTHROPIC'
  | 'GOOGLE'
  | 'GROQ'
  | 'CUSTOM'
  | 'DEEPSEEK';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;

  // server 端不应依赖 DOM
  element?: unknown;

  platform: SupportedPlatform;
}

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

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}