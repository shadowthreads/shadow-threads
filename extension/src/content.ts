/**
 * Shadow Threads Content Script
 * 注入到 LLM 页面，提供影子追问功能
 */

import { getAdapter } from './adapters';
import { detectPlatform, getPlatformConfig } from './core/platforms';
import { ConversationMessage, SupportedPlatform, CreateSubthreadRequest } from './types';
import {
  initSidebar,
  openSidebar,
  handleSubthreadResponse,
  handleSubthreadError,
  resetSidebar,
  toggleSidebar,
  setLoadingText,
  addMessage
} from './ui/sidebar';
import { initSelectionEngine } from './ui/selection';

type UAContextMsg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

function isUserOrAssistant(
  m: { role: 'user' | 'assistant' | 'system' }
): m is { role: 'user' | 'assistant' } {
  return m.role === 'user' || m.role === 'assistant';
}

// ============================================
// 全局状态
// ============================================

let currentPlatform: SupportedPlatform;
let isInitialized = false;
let currentMessage: ConversationMessage | null = null;

// ✅ 稳定性：请求级绑定 + 软/硬超时（保持你昨晚最终版）
let pendingRequestId: string | null = null;
let cancelledRequestIds = new Set<string>();
let softTimer: number | null = null;
let hardTimer: number | null = null;
let pendingStartedAt = 0;

const SOFT_TIMEOUT_MS = 30_000;     // 30s：只提示，不报错
const HARD_TIMEOUT_MS = 5 * 60_000; // 5min：真正超时才报错

function clearPending() {
  pendingRequestId = null;
  pendingStartedAt = 0;

  if (softTimer) {
    clearTimeout(softTimer);
    softTimer = null;
  }
  if (hardTimer) {
    clearTimeout(hardTimer);
    hardTimer = null;
  }

  // 恢复默认 loading 文案（不一定在 loading 状态，但安全）
  setLoadingText('正在思考...');
}

function genRequestId(): string {
  return `st-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ============================================
// ✅ MV3 Keep-Alive（关键修复）
// 通过长连接 port 防止 background service worker 在慢请求时被 suspend
// ============================================

let keepAlivePort: chrome.runtime.Port | null = null;
let keepAliveTimer: number | null = null;
let reconnectTimer: number | null = null;

// ✅ page lifecycle gate：BFCache/pagehide 时禁止启动/重连
let keepAliveEnabled = true;

function setupBFCacheGuards() {
  window.addEventListener('pagehide', () => {
    keepAliveEnabled = false;
    stopKeepAlive();
  });

  window.addEventListener('pageshow', () => {
    keepAliveEnabled = true;
    startKeepAlive();
  });
}

function startKeepAlive() {
  // BFCache/pagehide 时不允许启动
  if (!keepAliveEnabled) return;

  stopKeepAlive();

  try {
    keepAlivePort = chrome.runtime.connect({ name: 'st-keepalive' });

    keepAlivePort.onDisconnect.addListener(() => {
      // background 被重启/挂起都会导致 disconnect
      stopKeepAlive();
      if (keepAliveEnabled) scheduleReconnect();
    });

    // 每 20s ping 一次
    keepAliveTimer = window.setInterval(() => {
      try {
        keepAlivePort?.postMessage({ type: 'PING', t: Date.now() });
      } catch {
        // ignore
      }
    }, 20_000);

    // 立即 ping 一次
    try {
      keepAlivePort.postMessage({ type: 'PING', t: Date.now() });
    } catch {
      // ignore
    }

    console.log('[ShadowThreads] KeepAlive port connected');
  } catch {
    stopKeepAlive();
    if (keepAliveEnabled) scheduleReconnect();
  }
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try {
    keepAlivePort?.disconnect();
  } catch {
    // ignore
  }
  keepAlivePort = null;
}

function scheduleReconnect() {
  if (!keepAliveEnabled) return;
  if (reconnectTimer) return;

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (keepAliveEnabled) startKeepAlive();
  }, 1500);
}

// ============================================
// 初始化
// ============================================

function init() {
  if (isInitialized) return;

  currentPlatform = detectPlatform();

  console.log('='.repeat(50));
  console.log('[ShadowThreads] Content script loaded');
  console.log('[ShadowThreads] Platform:', currentPlatform);
  console.log('[ShadowThreads] URL:', window.location.href);
  console.log('='.repeat(50));

  // ✅ BFCache/page lifecycle guards（必须先挂监听，再启动 keepAlive）
  setupBFCacheGuards();

  // ✅ 启动 keep-alive（最重要的一行）
  startKeepAlive();

  if (currentPlatform === 'unknown') {
    console.warn('[ShadowThreads] Unknown platform, some features may not work');
  }

  initSidebar();
  initSelectionEngine(handleSelection);

  showLoadingBanner();

  setTimeout(() => {
    scanAndAddButtons();
  }, 1500);

  setupMutationObserver();
  setupMessageListener();
  setupSendListener();
  setupPinSnapshotListener();
  setupCancelPendingListener();
  setupApplySnapshotListener();

  isInitialized = true;
}

// ============================================
// 选择处理
// ============================================

function handleSelection(text: string, message: ConversationMessage | null): void {
  console.log('[ShadowThreads] Selection:', text.slice(0, 50) + '...');

  currentMessage = message;

  resetSidebar();
  openSidebar(text);
}

// ============================================
// 发送监听
// ============================================

function setupSendListener(): void {
  window.addEventListener('st-send-question', ((e: CustomEvent) => {
    const { question, selectionText, requestId } = e.detail || {};
    submitQuestion(selectionText, question, requestId);
  }) as EventListener);
}

// ============================================
// ✅ Pin Snapshot 监听（来自 sidebar 的 window event）
// ============================================

function setupPinSnapshotListener(): void {
  window.addEventListener('st-pin-snapshot', ((e: CustomEvent) => {
    const { subthreadId, requestId } = e.detail || {};
    if (!subthreadId) return;
    submitPinSnapshot(String(subthreadId), requestId);
  }) as EventListener);
}

function submitPinSnapshot(subthreadId: string, requestId?: string) {
  const rid = requestId || genRequestId();

  // 这里不复用 pendingRequestId / loading：Pin 是轻量动作，不应该把“提问”链路卡住
  chrome.runtime.sendMessage(
    {
      type: 'PIN_SNAPSHOT',
      requestId: rid,
      data: { subthreadId }
    },
    (response) => {
      if (chrome.runtime.lastError) {
        handleSubthreadError(chrome.runtime.lastError.message || 'PIN_SNAPSHOT 发送失败');
        return;
      }
      // background 会异步再发 PIN_SNAPSHOT_RESULT / PIN_SNAPSHOT_ERROR
      console.log('[ShadowThreads] BG ack (PIN_SNAPSHOT):', response);
    }
  );
}

function setupCancelPendingListener(): void {
  window.addEventListener('st-cancel-pending', (() => {
    if (pendingRequestId) cancelledRequestIds.add(pendingRequestId);
    clearPending();
    addMessage({
      id: `cancel-${Date.now()}`,
      role: 'SYSTEM',
      content: '⏹ 已停止生成（本地取消）',
      createdAt: new Date().toISOString()
    });
  }) as EventListener);
}

// ============================================
// ✅ Apply Snapshot 监听（来自 sidebar 的 window event）
// ============================================

function setupApplySnapshotListener(): void {
  window.addEventListener('st-apply-snapshot', ((e: CustomEvent) => {
    const { snapshotId, intent, requestId } = e.detail || {};
    if (!snapshotId) return;
    submitApplySnapshot(String(snapshotId), intent, requestId);
  }) as EventListener);
}

function submitApplySnapshot(snapshotId: string, intent?: string, requestId?: string) {
  const rid = requestId || genRequestId();

  chrome.runtime.sendMessage(
    {
      type: 'APPLY_SNAPSHOT',
      requestId: rid,
      data: { snapshotId, intent }
    },
    (response) => {
      if (chrome.runtime.lastError) {
        handleSubthreadError(chrome.runtime.lastError.message || 'APPLY_SNAPSHOT 发送失败');
        return;
      }
      console.log('[ShadowThreads] BG ack (APPLY_SNAPSHOT):', response);
    }
  );
}

// ============================================
// UI: 加载提示
// ============================================

function showLoadingBanner() {
  const banner = document.createElement('div');
  banner.id = 'st-loading-banner';
  banner.innerHTML = `
    <div class="st-banner">
      <span class="st-banner-icon">🌙</span>
      <span class="st-banner-text">Shadow Threads 已加载</span>
      <span class="st-banner-platform">${currentPlatform}</span>
    </div>
  `;

  document.body.appendChild(banner);

  setTimeout(() => {
    banner.style.animation = 'st-fade-out 0.3s ease-out forwards';
    setTimeout(() => banner.remove(), 300);
  }, 3000);
}

// ============================================
// 扫描并添加按钮
// ============================================

function scanAndAddButtons() {
  const adapter = getAdapter(currentPlatform);

  if (!adapter) {
    console.warn('[ShadowThreads] No adapter available for platform:', currentPlatform);
    return;
  }

  const messages = adapter.getAssistantMessages();
  console.log(`[ShadowThreads] Found ${messages.length} assistant messages`);

  messages.forEach((msg) => {
    if (adapter.hasButton(msg.element)) return;

    addShadowButton(msg);
    adapter.markProcessed(msg.element);
  });
}

// ============================================
// 添加影子追问按钮
// ============================================

function addShadowButton(message: ConversationMessage) {
  const btn = document.createElement('button');
  btn.className = 'st-shadow-btn';
  btn.innerHTML = '🌙';
  btn.title = '影子追问 - 深入探索这段内容';

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleShadowButtonClick(message);
  });

  const parent = message.element;
  const computedStyle = window.getComputedStyle(parent);
  if (computedStyle.position === 'static') {
    parent.style.position = 'relative';
  }

  parent.appendChild(btn);
}

// ============================================
// 处理按钮点击
// ============================================

function handleShadowButtonClick(message: ConversationMessage) {
  const selection = window.getSelection();
  let selectionText = selection?.toString().trim() || '';

  if (!selectionText) selectionText = message.content;

  console.log('[ShadowThreads] Button clicked');

  currentMessage = message;

  resetSidebar();
  openSidebar(selectionText);
}

// ============================================
// 提交问题
// ============================================

function submitQuestion(selectionText: string, userQuestion: string, requestId?: string) {
  const adapter = getAdapter(currentPlatform);
  const config = getPlatformConfig(currentPlatform);

  const message = currentMessage || {
    id: `msg-${Date.now()}`,
    role: 'assistant' as const,
    content: selectionText,
    element: document.body,
    platform: currentPlatform
  };

  const rid = requestId || genRequestId();
  pendingRequestId = rid;
  pendingStartedAt = Date.now();

  // ✅ 软超时：只更新 loading 文案，不报错、不清 pending
  if (softTimer) clearTimeout(softTimer);
  softTimer = window.setTimeout(() => {
    if (pendingRequestId === rid) {
      const waited = Math.floor((Date.now() - pendingStartedAt) / 1000);
      setLoadingText(`仍在思考…（已等待 ${waited}s）`);
    }
  }, SOFT_TIMEOUT_MS);

  // ✅ 硬超时：真正结束（避免无限 loading）
  if (hardTimer) clearTimeout(hardTimer);
  hardTimer = window.setTimeout(() => {
    if (pendingRequestId === rid) {
      clearPending();
      handleSubthreadError(`请求超时（>${Math.floor(HARD_TIMEOUT_MS / 1000)}s），请重试`);
    }
  }, HARD_TIMEOUT_MS);

  // ===== L1 上下文窗口（最小实现）=====
let contextMessages: { id: string; role: 'user' | 'assistant'; content: string }[] | undefined;

try {
  const allMessages = adapter?.getMessages() || [];
  const anchorIndex = allMessages.findIndex(m => m.id === message.id);

  if (anchorIndex >= 0) {
    const ABOVE = 8;
    const BELOW = 0;

    const start = Math.max(0, anchorIndex - ABOVE);
    const end = Math.min(allMessages.length, anchorIndex + 1 + BELOW);

    contextMessages = allMessages
      .slice(start, end)
      .filter((m): m is (typeof m & { role: 'user' | 'assistant' }) => m.role === 'user' || m.role === 'assistant')
      .map((m): UAContextMsg => ({
        id: m.id,
        role: m.role,      // ✅ 现在这里不会再是 system
        content: m.content
      }));
  }
} catch (e) {
  console.warn('[ShadowThreads] Failed to build context window:', e);
}

// ===== 原有请求 + 新字段 =====
const request: CreateSubthreadRequest & { contextMessages?: any[] } = {
  platform: currentPlatform,
  conversationId: adapter?.getConversationId() || window.location.pathname,
  conversationUrl: window.location.href,
  messageId: message.id,
  messageRole: message.role,
  messageText: message.content,
  selectionText,
  userQuestion,
  provider: config.provider,
  model: config.defaultModel,
  ...(contextMessages ? { contextMessages } : {})
};

  console.log('[ShadowThreads] Sending request:', { requestId: rid, request });

  chrome.runtime.sendMessage(
    {
      type: 'CREATE_SUBTHREAD',
      requestId: rid,
      data: request
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error('[ShadowThreads] Error:', chrome.runtime.lastError);
        clearPending();
        handleSubthreadError(chrome.runtime.lastError.message || '发送失败');
        return;
      }
      console.log('[ShadowThreads] BG ack:', response);
    }
  );
}

// ============================================
// 消息监听
// ============================================

function setupMessageListener() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log('[ShadowThreads] Received message:', msg);

    try {
      switch (msg.type) {
        case 'SUBTHREAD_RESPONSE': {
          const rid = msg.requestId || msg.data?.requestId;

          // ✅ 如果用户已本地取消该 request，则丢弃回包
          if (rid && cancelledRequestIds.has(rid)) {
            console.warn('[ShadowThreads] Dropped cancelled response:', rid);
            cancelledRequestIds.delete(rid);
            break;
          }

          if (pendingRequestId && rid && rid !== pendingRequestId) {
            console.warn('[ShadowThreads] Ignored stale response:', { rid, pendingRequestId });
            break;
          }

          if (msg.data) {
            handleSubthreadResponse(msg.data);
          } else {
            handleSubthreadError('响应为空');
          }

          clearPending();
          break;
        }

        case 'SUBTHREAD_ERROR': {
          const rid = msg.requestId || msg.data?.requestId;

          // ✅ 如果用户已本地取消该 request，则丢弃错误回包
          if (rid && cancelledRequestIds.has(rid)) {
            console.warn('[ShadowThreads] Dropped cancelled error:', rid);
            cancelledRequestIds.delete(rid);
            break;
          }

          if (pendingRequestId && rid && rid !== pendingRequestId) {
            console.warn('[ShadowThreads] Ignored stale error:', { rid, pendingRequestId });
            break;
          }

          handleSubthreadError(msg.data?.error || '请求失败');
          clearPending();
          break;
        }

        // ✅ Phase 1.5：Apply Snapshot 成功（中性语义，复用现有 subthread 渲染）
        case 'APPLY_SNAPSHOT_RESULT': {
          const d = msg.data || {};
          const subthreadResponse = d.subthreadResponse;

          if (subthreadResponse) {
            handleSubthreadResponse(subthreadResponse);
          } else {
            handleSubthreadError('APPLY_SNAPSHOT_RESULT 缺少 subthreadResponse');
          }
          break;
        }

        // ✅ Phase 1.5：Apply Snapshot 失败
        case 'APPLY_SNAPSHOT_ERROR': {
          const errMsg = msg.data?.error || 'Apply Snapshot 失败';
          handleSubthreadError(errMsg);
          break;
        }

        // ✅ Pin Snapshot：成功
        case 'PIN_SNAPSHOT_RESPONSE': {
          const d = msg.data || {};
          const pinnedId = d?.pinnedStateSnapshotId || d?.pinnedSnapshotId || d?.id;

          addMessage({
            id: `pin-${Date.now()}`,
            role: 'SYSTEM',
            content: pinnedId
              ? `📌 Snapshot 已固定\n- id: ${pinnedId}\n- rev: ${d.rev}\n- rootId: ${d.rootId}\n- parentId: ${d.parentId ?? 'null'}`
              : `📌 已固定 Snapshot（但返回体缺少 pinnedStateSnapshotId）`,
            createdAt: new Date().toISOString()
          });

          // 广播 window event，供 sidebar 做更强 UI（可选）
          try {
            window.dispatchEvent(new CustomEvent('st-pin-snapshot-result', { detail: d }));
          } catch {
            // ignore
          }

          break;
        }

        // ✅ Pin Snapshot：失败
        case 'PIN_SNAPSHOT_ERROR': {
          const errMsg = msg.data?.error || 'Pin Snapshot 失败';
          handleSubthreadError(errMsg);

          try {
            window.dispatchEvent(new CustomEvent('st-pin-snapshot-error', { detail: msg.data || { error: errMsg } }));
          } catch {
            // ignore
          }

          break;
        }

        case 'TOGGLE_SIDEBAR':
          toggleSidebar();
          break;
      }
    } catch (err: any) {
      console.error('[ShadowThreads] onMessage handler crashed:', err);
      clearPending();
      handleSubthreadError(err?.message || '渲染异常导致请求中断');
    }

    sendResponse({ received: true });
    return false;
  });
}

// ============================================
// DOM 监听
// ============================================

function setupMutationObserver() {
  let debounceTimer: number | null = null;

  const observer = new MutationObserver((mutations) => {
    let hasNewNodes = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        hasNewNodes = true;
        break;
      }
    }
    if (!hasNewNodes) return;

    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = window.setTimeout(() => {
      scanAndAddButtons();
    }, 500);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// ============================================
// 启动
// ============================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}