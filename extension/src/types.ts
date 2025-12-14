/**
 * Shadow Threads Extension 类型定义
 */

// ============================================
// 平台相关
// ============================================

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
  | 'DEEPSEEK'; // 你后端提到支持 fallback，补上枚举

export interface PlatformConfig {
  platform: SupportedPlatform;
  provider: LLMProvider;
  defaultModel: string;
  urlPatterns: RegExp[];
  selectors: PlatformSelectors;
}

export interface PlatformSelectors {
  messageContainer: string;
  userMessage: string;
  assistantMessage: string;
  messageContent: string;
  messageIdAttr?: string;
}

// ============================================
// 消息相关
// ============================================

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  element: HTMLElement;
  platform: SupportedPlatform;
}

export interface SelectionInfo {
  text: string;
  startOffset: number;
  endOffset: number;
  parentMessage: ConversationMessage;
}

// ============================================
// API 通信
// ============================================

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

// ============================================
// API Key（扩展 UI 用）
// ============================================

export interface StoredApiKey {
  id: string;
  provider: LLMProvider;
  label?: string;
  isDefault: boolean;
  // 后端通常不会回传明文 key，这里用 masked
  maskedKey: string; // e.g. sk-****abcd
  createdAt?: string;
  updatedAt?: string;
}

// ============================================
// 扩展内部通信
// ============================================

export type MessageType =
  | 'CREATE_SUBTHREAD'
  | 'CONTINUE_SUBTHREAD'
  | 'SUBTHREAD_RESPONSE'
  | 'SUBTHREAD_ERROR'
  | 'GET_SETTINGS'
  | 'SAVE_SETTINGS'
  | 'PING'
  | 'TOGGLE_SIDEBAR'
  // ✅ API Key 管理
  | 'LIST_API_KEYS'
  | 'CREATE_API_KEY'
  | 'DELETE_API_KEY'
  | 'SET_DEFAULT_API_KEY'
  | 'VALIDATE_API_KEY';

export interface ExtensionMessage<T = unknown> {
  type: MessageType;
  requestId?: string;
  data?: T;
  tabId?: number;
}

// ============================================
// 设置
// ============================================

export interface ExtensionSettings {
  serverUrl: string;
  deviceId: string;
  defaultProvider?: LLMProvider;
  theme: 'auto' | 'light' | 'dark';
  language: string;
  showFloatingButton: boolean;
  sidebarWidth: number;

  softTimeoutMs: number; // 只提示
  hardTimeoutMs: number; // 真正超时
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  serverUrl: 'http://localhost:3001',
  deviceId: '',
  theme: 'auto',
  language: 'zh-CN',
  showFloatingButton: true,
  sidebarWidth: 400,
  softTimeoutMs: 30_000,
  hardTimeoutMs: 5 * 60_000
};