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
  | 'DEEPSEEK'; // ✅ 兼容 fallback 记录

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

// ✅ Pin Snapshot：请求（由 UI 发给 background）
export interface PinSnapshotRequest {
  subthreadId: string;
}

// ✅ Pin Snapshot：返回（background 发回 content）
export interface PinSnapshotResponse {
  pinnedStateSnapshotId: string;
  rootId: string;
  parentId: string | null;
  rev: number;
  subthreadId: string;
  version: string;
  baseStateSnapshotId?: string;
  baseCreatedAt?: string;
  baseFingerprint?: {
    anchorDescPreview?: string;
    strategy?: string;
  };
}

export interface PinSnapshotError {
  error: string;
}

// ✅ Phase 2.2：Apply Snapshot（把 snapshot 作为“信息核心”应用到某个目标）
// - userQuestion：必填（后端 continue endpoint 也要求必填）
// - mode：注入模式（bootstrap / constrain / review）
export type ApplyMode = 'bootstrap' | 'constrain' | 'review';

export interface ApplySnapshotRequest {
  snapshotId: string;
  userQuestion: string; // ✅ 必填：从该 snapshot 想推进的问题
  mode?: ApplyMode;     // ✅ 默认 bootstrap（前后端均可兜底）
  providerHint?: LLMProvider;
  modelHint?: string;
}

export interface ApplySnapshotResult {
  appliedSnapshotId: string;
  outcome: 'NEW_THREAD'; // 当前只有一种 outcome，未来可扩展（INJECT_TO_PAGE / COPY_PROMPT / etc.）
  // 当前实现细节：为了复用现有渲染链路，直接返回后端的 SubthreadResponse
  subthreadResponse: SubthreadResponse;
}

export interface ApplySnapshotError {
  error: string;
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
// Options / Debug / History 专用
// ============================================

export interface BackendHealthStatus {
  ok: boolean;
  serverUrl: string;
  checkedAt: number;
  latencyMs?: number;
  statusText?: string;
  error?: string;
}

export interface DebugStatus {
  serverUrl: string;
  deviceId: string;
  lastRequest?: LastRequestSnapshot | null;
}

export interface LastRequestSnapshot {
  requestId: string;
  kind: 'CREATE_SUBTHREAD' | 'CONTINUE_SUBTHREAD' | 'PIN_SNAPSHOT';
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;

  tabId?: number;
  conversationUrl?: string;

  providerWanted?: LLMProvider;
  modelWanted?: string;

  // 后端实际返回/记录（如果后端能返回）
  providerActual?: LLMProvider;
  modelActual?: string;
  fallbackToDeepSeek?: boolean;

  success?: boolean;
  error?: string;
  httpStatus?: number;
}

export interface SubthreadListItem {
  id: string;
  provider?: LLMProvider;
  model?: string;
  platform?: string;
  selectionText?: string;
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
  // ✅ Options/Debug/History
  | 'GET_DEBUG_STATUS'
  | 'CHECK_BACKEND_HEALTH'
  | 'OPEN_OPTIONS_PAGE'
  | 'FETCH_SUBTHREADS'
  | 'FETCH_SUBTHREAD_DETAIL'
  // ✅ Snapshot Pin（新）
  | 'PIN_SNAPSHOT'
  | 'PIN_SNAPSHOT_RESPONSE'
  | 'PIN_SNAPSHOT_ERROR'
  // ✅ Snapshot Apply（Phase 1.5：中性语义，面向可迁移）
  | 'APPLY_SNAPSHOT'
  | 'APPLY_SNAPSHOT_RESULT'
  | 'APPLY_SNAPSHOT_ERROR';

export interface ExtensionMessage<T = unknown> {
  type: MessageType;
  data?: T;
  tabId?: number;
  requestId?: string;
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
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  serverUrl: 'http://localhost:3001',
  deviceId: '',
  theme: 'auto',
  language: 'zh-CN',
  showFloatingButton: true,
  sidebarWidth: 400
};