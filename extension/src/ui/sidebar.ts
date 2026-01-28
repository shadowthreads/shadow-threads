/**
 * 侧边栏 UI 组件
 * 提供完整的对话界面
 */

import { SubthreadMessage, SubthreadResponse } from '../types';

// ============================================
// 侧边栏状态
// ============================================

interface SidebarState {
  isOpen: boolean;
  isLoading: boolean;
  currentSubthreadId: string | null;
  messages: SubthreadMessage[];
  selectionText: string;
  error: string | null;
}

let state: SidebarState = {
  isOpen: false,
  isLoading: false,
  currentSubthreadId: null,
  messages: [],
  selectionText: '',
  error: null
};

let sidebarElement: HTMLElement | null = null;

function genRequestId(): string {
  return `st-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ============================================
// 侧边栏 HTML 结构
// ============================================

function createSidebarHTML(): string {
  return `
    <div class="st-sidebar" id="st-sidebar">
      <div class="st-sidebar-header">
        <div class="st-sidebar-title">
          <span class="st-sidebar-icon">🌙</span>
          <span>影子追问</span>
        </div>
        <div class="st-sidebar-actions">
          <button class="st-sidebar-btn" id="st-sidebar-history" title="历史记录">📋</button>
          <button class="st-sidebar-btn" id="st-sidebar-pin" title="Create snapshot here">📌</button>
          <button class="st-sidebar-btn" id="st-sidebar-settings" title="设置">⚙️</button>
          <button class="st-sidebar-btn st-sidebar-close" id="st-sidebar-close" title="关闭">✕</button>
        </div>
      </div>

      <div class="st-sidebar-context" id="st-sidebar-context">
        <div class="st-context-label">选中内容</div>
        <div class="st-context-text" id="st-context-text"></div>
      </div>

      <div class="st-sidebar-messages" id="st-sidebar-messages">
        <div class="st-empty-state" id="st-empty-state">
          <div class="st-empty-icon">💬</div>
          <div class="st-empty-text">选中文字后输入问题开始追问</div>
        </div>
      </div>

      <div class="st-sidebar-input">
        <div class="st-input-wrapper">
          <textarea
            id="st-input-textarea"
            placeholder="输入你的问题... (Ctrl+Enter 发送)"
            rows="2"
          ></textarea>
          <button class="st-send-btn" id="st-send-btn" title="发送">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </div>
        <div class="st-input-hint">Ctrl+Enter 发送 · 支持多轮对话</div>
      </div>

      <div class="st-sidebar-loading" id="st-sidebar-loading" style="display: none;">
        <div class="st-loading-spinner"></div>
        <span id="st-loading-text">正在思考...</span>
        <button class="st-sidebar-btn" id="st-stop-btn" title="停止">⏹</button>
      </div>

      <div class="st-sidebar-error" id="st-sidebar-error" style="display: none;">
        <span class="st-error-icon">⚠️</span>
        <span class="st-error-text" id="st-error-text"></span>
        <button class="st-error-close" id="st-error-close">✕</button>
      </div>
    </div>
  `;
}

// ============================================
// 侧边栏操作
// ============================================

export function initSidebar(): void {
  if (document.getElementById('st-sidebar')) return;

  const container = document.createElement('div');
  container.id = 'st-sidebar-container';
  container.innerHTML = createSidebarHTML();
  document.body.appendChild(container);

  sidebarElement = document.getElementById('st-sidebar');

  bindSidebarEvents();

  // 初始状态：未创建子对话时禁用 Pin
  const pinBtn = document.getElementById('st-sidebar-pin') as HTMLButtonElement | null;
  if (pinBtn) pinBtn.disabled = true;

  console.log('[ShadowThreads] Sidebar initialized');
}

function bindSidebarEvents(): void {
  document.getElementById('st-sidebar-close')?.addEventListener('click', closeSidebar);
  document.getElementById('st-send-btn')?.addEventListener('click', handleSend);
  document.getElementById('st-stop-btn')?.addEventListener('click', () => {
    try {
      window.dispatchEvent(new CustomEvent('st-cancel-pending'));
    } catch {
      // ignore
    }
  });
  // ✅ Phase 2.2：临时入口（后续会替换成 Snapshot Library 面板）
  // 点击 📋 → 输入 snapshotId → 选择 mode → 输入 userQuestion → Apply Snapshot
  document.getElementById('st-sidebar-history')?.addEventListener('click', () => {
    try {
      const snapshotId = window.prompt('输入要继续的 Snapshot ID：');
      if (!snapshotId || !snapshotId.trim()) return;

      const modeRaw = window.prompt('选择 Apply mode：bootstrap / constrain / review（默认 bootstrap）', 'bootstrap');
      const mode = (modeRaw || 'bootstrap').trim().toLowerCase();
      if (!['bootstrap', 'constrain', 'review'].includes(mode)) {
        showError('mode 无效：请填写 bootstrap / constrain / review');
        return;
      }

      const userQuestion = window.prompt('从这里开始，你想沿着什么问题继续？（必填）');
      if (!userQuestion || !userQuestion.trim()) return;

      const requestId = genRequestId();
      showLoading();
      hideError();

      window.dispatchEvent(new CustomEvent('st-apply-snapshot', {
        detail: {
          snapshotId: snapshotId.trim(),
          userQuestion: userQuestion.trim(),
          mode,
          requestId
        }
      }));
    } catch {
      // ignore
    }
  });

  // ✅ Pin Snapshot：由 content.ts 负责真正发请求（这里仅发事件）
  document.getElementById('st-sidebar-pin')?.addEventListener('click', () => {
    try {
      // Snapshot 必须绑定 subthreadId：薄 UI 约束
      if (!state.currentSubthreadId) {
        showError('请先发送一次问题创建子对话后，再创建 Snapshot');
        return;
      }

      const requestId = genRequestId();

      window.dispatchEvent(new CustomEvent('st-pin-snapshot', {
        detail: {
          subthreadId: state.currentSubthreadId,
          requestId
        }
      }));
    } catch {
      // ignore
    }
  });

  // ✅ 设置按钮：打开 Options Page（纯增量，不影响稳定链路）
  document.getElementById('st-sidebar-settings')?.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' });
    } catch {
      // ignore
    }
  });

  const textarea = document.getElementById('st-input-textarea') as HTMLTextAreaElement;
  textarea?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;

    // Shift+Enter：换行（默认行为），不拦截
    if (e.shiftKey) return;

    // Enter：发送（Ctrl/Meta+Enter 也发送，兼容原行为）
    e.preventDefault();
    handleSend();
  });

  textarea?.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
  });

  document.getElementById('st-error-close')?.addEventListener('click', () => {
    hideError();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.isOpen) closeSidebar();
  });
}

export function openSidebar(selectionText: string = ''): void {
  if (!sidebarElement) {
    initSidebar();
    sidebarElement = document.getElementById('st-sidebar');
  }

  state.isOpen = true;
  state.selectionText = selectionText;

  sidebarElement?.classList.add('st-sidebar-open');
  document.body.classList.add('st-sidebar-active');

  updateContextPreview(selectionText);

  setTimeout(() => {
    const textarea = document.getElementById('st-input-textarea') as HTMLTextAreaElement;
    textarea?.focus();
  }, 100);
}

export function closeSidebar(): void {
  state.isOpen = false;
  sidebarElement?.classList.remove('st-sidebar-open');
  document.body.classList.remove('st-sidebar-active');
}

export function toggleSidebar(): void {
  if (state.isOpen) closeSidebar();
  else openSidebar();
}

function updateContextPreview(text: string): void {
  const contextEl = document.getElementById('st-sidebar-context');
  const textEl = document.getElementById('st-context-text');

  if (text && text.length > 0) {
    contextEl?.classList.add('st-context-visible');
    if (textEl) textEl.textContent = text.length > 300 ? text.slice(0, 300) + '...' : text;
  } else {
    contextEl?.classList.remove('st-context-visible');
  }
}

// ============================================
// loading 文案（供 content.ts 软超时提示）
// ============================================

export function setLoadingText(text: string): void {
  const el = document.getElementById('st-loading-text');
  if (el) el.textContent = text;
}

// ============================================
// 消息处理
// ============================================

async function handleSend(): Promise<void> {
  const textarea = document.getElementById('st-input-textarea') as HTMLTextAreaElement;
  const question = textarea?.value.trim();

  if (!question) {
    textarea?.focus();
    return;
  }

  textarea.value = '';
  textarea.style.height = 'auto';

  const requestId = genRequestId();

  addMessage({
    id: `temp-${requestId}`,
    role: 'USER',
    content: question,
    createdAt: new Date().toISOString()
  });

  showLoading();
  hideError();

  try {
    if (state.currentSubthreadId) {
      chrome.runtime.sendMessage({
        type: 'CONTINUE_SUBTHREAD',
        requestId,
        data: {
          subthreadId: state.currentSubthreadId,
          userQuestion: question
        }
      });
    } else {
      window.dispatchEvent(new CustomEvent('st-send-question', {
        detail: { question, selectionText: state.selectionText, requestId }
      }));
    }
  } catch (error) {
    hideLoading();
    showError(error instanceof Error ? error.message : '发送失败');
  }
}

export function addMessage(message: SubthreadMessage): void {
  state.messages.push(message);
  renderMessages();
}

function renderMessages(): void {
  const container = document.getElementById('st-sidebar-messages');
  const emptyState = document.getElementById('st-empty-state');

  if (!container) return;

  if (state.messages.length === 0) {
    emptyState?.style.setProperty('display', 'flex');
    return;
  }

  emptyState?.style.setProperty('display', 'none');

  const existingMessages = container.querySelectorAll('.st-message');
  existingMessages.forEach(el => el.remove());

  state.messages.forEach(msg => {
    const msgEl = createMessageElement(msg);
    container.appendChild(msgEl);
  });

  container.scrollTop = container.scrollHeight;
}

function createMessageElement(message: SubthreadMessage): HTMLElement {
  const el = document.createElement('div');
  const role = (message.role || 'SYSTEM').toLowerCase();
  el.className = `st-message st-message-${role}`;

  const isUser = message.role === 'USER';

  el.innerHTML = `
    <div class="st-message-avatar">${isUser ? '👤' : '🌙'}</div>
    <div class="st-message-content">
      <div class="st-message-text">${formatMessageContent(message.content || '')}</div>
      <div class="st-message-time">${formatTime(message.createdAt || new Date().toISOString())}</div>
    </div>
  `;

  return el;
}

function formatMessageContent(content: string): string {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// ============================================
// 状态更新
// ============================================

export function handleSubthreadResponse(data: SubthreadResponse): void {
  try {
    hideLoading();
    hideError();

    const anyData: any = data as any;
    const subthreadId =
      anyData?.subthread?.id ??
      anyData?.subthreadId ??
      state.currentSubthreadId;

    if (subthreadId) state.currentSubthreadId = subthreadId;

    // 有 subthreadId 才允许 Pin
    const pinBtn = document.getElementById('st-sidebar-pin') as HTMLButtonElement | null;
    if (pinBtn) pinBtn.disabled = !state.currentSubthreadId;


    if (Array.isArray(anyData?.messages)) {
      state.messages = anyData.messages;
      renderMessages();
      return;
    }

    if (anyData?.assistantReply?.content) {
      addMessage({
        id: anyData.assistantReply.id || `asst-${Date.now()}`,
        role: 'ASSISTANT',
        content: anyData.assistantReply.content,
        createdAt: new Date().toISOString()
      });
    }
  } catch (e: any) {
    hideLoading();
    showError(e?.message || '响应处理失败');
  }
}

export function handleSubthreadError(error: string): void {
  try {
    hideLoading();
    showError(error);
    renderMessages();
  } catch (e: any) {
    hideLoading();
    showError(e?.message || '错误处理失败');
  }
}

function showLoading(): void {
  state.isLoading = true;
  setLoadingText('正在思考...');
  document.getElementById('st-sidebar-loading')?.style.setProperty('display', 'flex');
}

function hideLoading(): void {
  state.isLoading = false;
  setLoadingText('正在思考...');
  document.getElementById('st-sidebar-loading')?.style.setProperty('display', 'none');
}

function showError(message: string): void {
  state.error = message;
  const errorEl = document.getElementById('st-sidebar-error');
  const textEl = document.getElementById('st-error-text');

  if (textEl) textEl.textContent = message;
  errorEl?.style.setProperty('display', 'flex');
}

function hideError(): void {
  state.error = null;
  document.getElementById('st-sidebar-error')?.style.setProperty('display', 'none');
}

export function resetSidebar(): void {
  state.currentSubthreadId = null;
  state.messages = [];
  state.selectionText = '';
  state.error = null;
  hideLoading();
  hideError();

  const pinBtn = document.getElementById('st-sidebar-pin') as HTMLButtonElement | null;
  if (pinBtn) pinBtn.disabled = true;

  renderMessages();
  updateContextPreview('');
}

export function getSidebarState(): SidebarState {
  return { ...state };
}