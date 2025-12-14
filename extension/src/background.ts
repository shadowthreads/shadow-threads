/**
 * Shadow Threads Background Service Worker
 * 处理扩展与后端服务器之间的通信（MV3）
 */

import { ExtensionMessage, CreateSubthreadRequest, DEFAULT_SETTINGS } from './types';

// ============================================
// 配置
// ============================================

let serverUrl = DEFAULT_SETTINGS.serverUrl;
let deviceId = '';

// ✅ ready gate：任何消息处理前都确保 settings 已加载
let readyResolve: (() => void) | null = null;
const ready = new Promise<void>((resolve) => {
  readyResolve = resolve;
});

// ============================================
// 初始化
// ============================================

async function init() {
  console.log('='.repeat(50));
  console.log('[ShadowThreads BG] Background service worker started');
  console.log('='.repeat(50));

  await loadSettings();
  checkServer();

  readyResolve?.();
  readyResolve = null;
}

async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(['serverUrl', 'deviceId']);

    if (result.serverUrl) serverUrl = result.serverUrl;

    if (result.deviceId) {
      deviceId = result.deviceId;
    } else {
      deviceId = generateDeviceId();
      await chrome.storage.local.set({ deviceId });
    }

    console.log('[ShadowThreads BG] Server URL:', serverUrl);
    console.log('[ShadowThreads BG] Device ID:', deviceId);
  } catch (error) {
    console.error('[ShadowThreads BG] Failed to load settings:', error);
    deviceId = generateDeviceId();
    try {
      await chrome.storage.local.set({ deviceId });
    } catch {
      // ignore
    }
  }
}

function generateDeviceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `st_${timestamp}_${random}`;
}

async function checkServer() {
  try {
    const response = await fetch(`${serverUrl}/api/v1/health`);
    const data = await response.json();

    if (data.status === 'ok') {
      console.log('[ShadowThreads BG] ✅ Server is healthy');
    } else {
      console.warn('[ShadowThreads BG] ⚠️ Server returned non-ok status');
    }
  } catch (error) {
    console.warn('[ShadowThreads BG] ⚠️ Server is not responding');
    console.warn('[ShadowThreads BG] Make sure server is running at:', serverUrl);
  }
}

// ============================================
// ✅ MV3 Keep-Alive：监听长连接 port
// 只要 port 活着，SW 就不会轻易被 suspend（慢请求更稳）
// ============================================

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'st-keepalive') return;

  console.log('[ShadowThreads BG] KeepAlive port connected');

  port.onMessage.addListener((msg) => {
    // 什么都不需要做，收到消息就能保活
    if (msg?.type === 'PING') {
      // 可选：debug
      // console.log('[ShadowThreads BG] KeepAlive PING', msg.t);
    }
  });

  port.onDisconnect.addListener(() => {
    console.log('[ShadowThreads BG] KeepAlive port disconnected');
  });
});

// ============================================
// 消息处理
// ============================================

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  console.log('[ShadowThreads BG] Received message:', message.type);

  const tabId = sender.tab?.id;
  const requestId = message.requestId;

  switch (message.type) {
    case 'CREATE_SUBTHREAD': {
      (async () => {
        await ready; // ✅ 等 settings ready
        handleCreateSubthread(message.data as CreateSubthreadRequest, tabId, requestId);
      })();

      sendResponse({ received: true, requestId });
      return false;
    }

    case 'CONTINUE_SUBTHREAD': {
      (async () => {
        await ready; // ✅ 等 settings ready
        handleContinueSubthread(message.data, tabId, requestId);
      })();

      sendResponse({ received: true, requestId });
      return false;
    }

    case 'PING': {
      sendResponse({ pong: true, serverUrl, deviceId });
      return false;
    }

    default: {
      sendResponse({ error: 'Unknown message type' });
      return false;
    }
  }
});

// ============================================
// API 调用
// ============================================

async function handleCreateSubthread(data: CreateSubthreadRequest, tabId?: number, requestId?: string) {
  console.log('[ShadowThreads BG] Creating subthread...', { requestId, tabId });

  if (tabId == null) {
    console.error('[ShadowThreads BG] Missing tabId for CREATE_SUBTHREAD, cannot deliver response.');
    return;
  }

  try {
    const response = await fetch(`${serverUrl}/api/v1/subthreads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': deviceId,
        ...(requestId ? { 'X-Request-ID': requestId } : {})
      },
      body: JSON.stringify(data)
    });

    let result: any = null;
    try {
      result = await response.json();
    } catch {
      await sendToTab(tabId, {
        type: 'SUBTHREAD_ERROR',
        requestId,
        data: { error: `服务器返回非 JSON 响应（HTTP ${response.status}）` }
      });
      return;
    }

    console.log('[ShadowThreads BG] Server response:', { requestId, success: result?.success });

    if (result?.success) {
      await sendToTab(tabId, {
        type: 'SUBTHREAD_RESPONSE',
        requestId,
        data: result.data
      });
    } else {
      await sendToTab(tabId, {
        type: 'SUBTHREAD_ERROR',
        requestId,
        data: {
          error: result?.error?.message || `请求失败（HTTP ${response.status}）`
        }
      });
    }
  } catch (error) {
    console.error('[ShadowThreads BG] Request failed:', error);

    await sendToTab(tabId, {
      type: 'SUBTHREAD_ERROR',
      requestId,
      data: {
        error: error instanceof Error ? error.message : 'Network error'
      }
    });
  }
}

async function handleContinueSubthread(data: any, tabId?: number, requestId?: string) {
  console.log('[ShadowThreads BG] Continuing subthread...', { requestId, tabId });

  if (tabId == null) {
    console.error('[ShadowThreads BG] Missing tabId for CONTINUE_SUBTHREAD, cannot deliver response.');
    return;
  }

  try {
    const { subthreadId, ...rest } = data;

    const response = await fetch(`${serverUrl}/api/v1/subthreads/${subthreadId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': deviceId,
        ...(requestId ? { 'X-Request-ID': requestId } : {})
      },
      body: JSON.stringify(rest)
    });

    let result: any = null;
    try {
      result = await response.json();
    } catch {
      await sendToTab(tabId, {
        type: 'SUBTHREAD_ERROR',
        requestId,
        data: { error: `服务器返回非 JSON 响应（HTTP ${response.status}）` }
      });
      return;
    }

    if (result?.success) {
      await sendToTab(tabId, {
        type: 'SUBTHREAD_RESPONSE',
        requestId,
        data: result.data
      });
    } else {
      await sendToTab(tabId, {
        type: 'SUBTHREAD_ERROR',
        requestId,
        data: {
          error: result?.error?.message || `请求失败（HTTP ${response.status}）`
        }
      });
    }
  } catch (error) {
    console.error('[ShadowThreads BG] Request failed:', error);

    await sendToTab(tabId, {
      type: 'SUBTHREAD_ERROR',
      requestId,
      data: {
        error: error instanceof Error ? error.message : 'Network error'
      }
    });
  }
}

// ============================================
// 辅助函数
// ============================================

async function sendToTab(tabId: number, message: ExtensionMessage) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.error('[ShadowThreads BG] Failed to send to tab:', tabId, error);
  }
}

// ============================================
// 扩展图标点击
// ============================================

chrome.action.onClicked.addListener(async (tab) => {
  console.log('[ShadowThreads BG] Extension icon clicked');

  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SIDEBAR' } as ExtensionMessage);
  }
});

// ============================================
// 启动
// ============================================

init();