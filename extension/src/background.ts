/**
 * Shadow Threads Background Service Worker
 * 处理扩展与后端服务器之间的通信 + Options Debug/History
 */

import {
  ExtensionMessage,
  CreateSubthreadRequest,
  DEFAULT_SETTINGS,
  BackendHealthStatus,
  DebugStatus,
  LastRequestSnapshot,
  SubthreadListItem
} from './types';

// ============================================
// 配置
// ============================================

let serverUrl = DEFAULT_SETTINGS.serverUrl;
let deviceId = '';

// Debug snapshot（只读旁路，不影响主链路）
let lastRequest: LastRequestSnapshot | null = null;

// ============================================
// 初始化
// ============================================

async function init() {
  console.log('='.repeat(50));
  console.log('[ShadowThreads BG] Background service worker started');
  console.log('='.repeat(50));

  await loadSettings();
  checkServer();
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
// 消息处理
// ============================================

chrome.runtime.onMessage.addListener((
  message: ExtensionMessage,
  sender,
  sendResponse
) => {
  const tabId = sender.tab?.id;
  const requestId = message.requestId;

  console.log('[ShadowThreads BG] Received message:', message.type);

  switch (message.type) {
    case 'CREATE_SUBTHREAD': {
      handleCreateSubthread(message.data as CreateSubthreadRequest, tabId, requestId);
      sendResponse({ received: true, requestId });
      return false;
    }

    case 'CONTINUE_SUBTHREAD': {
      handleContinueSubthread(message.data, tabId, requestId);
      sendResponse({ received: true, requestId });
      return false;
    }

    case 'PING': {
      sendResponse({ pong: true, serverUrl, deviceId });
      return false;
    }

    // ✅ Options/Debug/History
    case 'SAVE_SETTINGS': {
      const d: any = message.data || {};
      if (typeof d.serverUrl === 'string' && d.serverUrl.trim()) {
        serverUrl = d.serverUrl.trim();
      }
      chrome.storage.local.set({ serverUrl }).then(() => {
        sendResponse({ ok: true, serverUrl });
      }).catch((e) => {
        sendResponse({ ok: false, error: e?.message || String(e) });
      });
      return true;
    }

    case 'GET_DEBUG_STATUS': {
      const res: DebugStatus = {
        serverUrl,
        deviceId,
        lastRequest: lastRequest || null
      };
      sendResponse({ ok: true, data: res });
      return false;
    }

    case 'CHECK_BACKEND_HEALTH': {
      handleBackendHealthCheck().then((status) => {
        sendResponse({ ok: true, data: status });
      }).catch((e) => {
        const status: BackendHealthStatus = {
          ok: false,
          serverUrl,
          checkedAt: Date.now(),
          error: e?.message || String(e)
        };
        sendResponse({ ok: true, data: status });
      });
      return true;
    }

    case 'FETCH_SUBTHREADS': {
      const limit = (message.data as any)?.limit;
      handleFetchSubthreads(typeof limit === 'number' ? limit : 20)
        .then((items) => sendResponse({ ok: true, data: items }))
        .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
      return true;
    }

    case 'FETCH_SUBTHREAD_DETAIL': {
      const subthreadId = (message.data as any)?.subthreadId;
      handleFetchSubthreadDetail(String(subthreadId || ''))
        .then((detail) => sendResponse({ ok: true, data: detail }))
        .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
      return true;
    }

    case 'OPEN_OPTIONS_PAGE': {
      chrome.runtime.openOptionsPage().then(() => {
        sendResponse({ ok: true });
      }).catch((e) => {
        sendResponse({ ok: false, error: e?.message || String(e) });
      });
      return true;
    }

    default: {
      sendResponse({ error: 'Unknown message type' });
      return false;
    }
  }
});

// ============================================
// 主链路：API 调用（保持稳定逻辑）
// ============================================

async function handleCreateSubthread(
  data: CreateSubthreadRequest,
  tabId?: number,
  requestId?: string
) {
  console.log('[ShadowThreads BG] Creating subthread...', { requestId, tabId });

  if (tabId == null) {
    console.error('[ShadowThreads BG] Missing tabId for CREATE_SUBTHREAD, cannot deliver response.');
    return;
  }

  // ✅ 记录 lastRequest（旁路观察，不影响功能）
  lastRequest = {
    requestId: requestId || `no-rid-${Date.now()}`,
    kind: 'CREATE_SUBTHREAD',
    startedAt: Date.now(),
    tabId,
    conversationUrl: data?.conversationUrl,
    providerWanted: data?.provider,
    modelWanted: data?.model
  };

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
      finalizeLastRequest(false, `non-json (HTTP ${response.status})`, response.status, undefined);
      return;
    }

    if (result?.success) {
      await sendToTab(tabId, {
        type: 'SUBTHREAD_RESPONSE',
        requestId,
        data: result.data
      });

      const actualProvider = result?.data?.subthread?.provider;
      const actualModel = result?.data?.subthread?.model;

      finalizeLastRequest(true, undefined, response.status, {
        providerActual: actualProvider,
        modelActual: actualModel,
        fallbackToDeepSeek: actualProvider === 'DEEPSEEK'
      });
    } else {
      const errMsg = result?.error?.message || `请求失败（HTTP ${response.status}）`;
      await sendToTab(tabId, {
        type: 'SUBTHREAD_ERROR',
        requestId,
        data: { error: errMsg }
      });
      finalizeLastRequest(false, errMsg, response.status, undefined);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Network error';
    console.error('[ShadowThreads BG] Request failed:', error);

    await sendToTab(tabId, {
      type: 'SUBTHREAD_ERROR',
      requestId,
      data: { error: msg }
    });

    finalizeLastRequest(false, msg, undefined, undefined);
  }
}

async function handleContinueSubthread(
  data: any,
  tabId?: number,
  requestId?: string
) {
  console.log('[ShadowThreads BG] Continuing subthread...', { requestId, tabId });

  if (tabId == null) {
    console.error('[ShadowThreads BG] Missing tabId for CONTINUE_SUBTHREAD, cannot deliver response.');
    return;
  }

  const { subthreadId, ...rest } = data || {};

  lastRequest = {
    requestId: requestId || `no-rid-${Date.now()}`,
    kind: 'CONTINUE_SUBTHREAD',
    startedAt: Date.now(),
    tabId
  };

  try {
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
      finalizeLastRequest(false, `non-json (HTTP ${response.status})`, response.status, undefined);
      return;
    }

    if (result?.success) {
      await sendToTab(tabId, {
        type: 'SUBTHREAD_RESPONSE',
        requestId,
        data: result.data
      });

      const actualProvider = result?.data?.subthread?.provider;
      const actualModel = result?.data?.subthread?.model;

      finalizeLastRequest(true, undefined, response.status, {
        providerActual: actualProvider,
        modelActual: actualModel,
        fallbackToDeepSeek: actualProvider === 'DEEPSEEK'
      });
    } else {
      const errMsg = result?.error?.message || `请求失败（HTTP ${response.status}）`;
      await sendToTab(tabId, {
        type: 'SUBTHREAD_ERROR',
        requestId,
        data: { error: errMsg }
      });
      finalizeLastRequest(false, errMsg, response.status, undefined);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Network error';
    console.error('[ShadowThreads BG] Request failed:', error);

    await sendToTab(tabId, {
      type: 'SUBTHREAD_ERROR',
      requestId,
      data: { error: msg }
    });

    finalizeLastRequest(false, msg, undefined, undefined);
  }
}

function finalizeLastRequest(
  success: boolean,
  error?: string,
  httpStatus?: number,
  extra?: Partial<LastRequestSnapshot>
) {
  if (!lastRequest) return;
  const finishedAt = Date.now();
  lastRequest = {
    ...lastRequest,
    ...extra,
    success,
    error,
    httpStatus,
    finishedAt,
    durationMs: Math.max(0, finishedAt - lastRequest.startedAt)
  };
}

// ============================================
// Options/Debug/History：旁路 API（只读）
// ============================================

async function handleBackendHealthCheck(): Promise<BackendHealthStatus> {
  const started = Date.now();
  try {
    const response = await fetch(`${serverUrl}/api/v1/health`, { method: 'GET' });
    const latencyMs = Date.now() - started;

    let json: any = null;
    try {
      json = await response.json();
    } catch {
      // ignore
    }

    const ok = response.ok && (json?.status === 'ok' || json?.ok === true);
    return {
      ok,
      serverUrl,
      checkedAt: Date.now(),
      latencyMs,
      statusText: ok ? 'ok' : `http_${response.status}`,
      ...(ok ? {} : { error: json ? JSON.stringify(json) : `HTTP ${response.status}` })
    };
  } catch (e: any) {
    return {
      ok: false,
      serverUrl,
      checkedAt: Date.now(),
      latencyMs: Date.now() - started,
      statusText: 'error',
      error: e?.message || String(e)
    };
  }
}

async function handleFetchSubthreads(limit: number): Promise<SubthreadListItem[]> {
  // server 使用 page / pageSize，而不是 limit
  const pageSize = limit;
  const page = 1;

  const url = new URL(`${serverUrl}/api/v1/subthreads`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(pageSize));

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-Device-ID': deviceId
    }
  });

  const json: any = await res.json();

  if (!json?.success) {
    throw new Error(json?.error?.message || `FETCH_SUBTHREADS failed (HTTP ${res.status})`);
  }

  const items = Array.isArray(json.data) ? json.data : [];
  if (!Array.isArray(items)) return [];

  // 映射成 Options 需要的结构
  return items.map((x: any) => ({
    id: x.id,
    provider: x.provider,
    model: x.model,
    platform: x.sourceContext?.platform,
    selectionText: x.sourceContext?.selectionText,
    createdAt: x.createdAt,
    updatedAt: x.updatedAt
  }));
}

async function handleFetchSubthreadDetail(subthreadId: string): Promise<any> {
  if (!subthreadId) throw new Error('missing subthreadId');

  const res = await fetch(`${serverUrl}/api/v1/subthreads/${subthreadId}`, {
    method: 'GET',
    headers: {
      'X-Device-ID': deviceId
    }
  });

  const json: any = await res.json();
  if (!json?.success) {
    throw new Error(json?.error?.message || `FETCH_SUBTHREAD_DETAIL failed (HTTP ${res.status})`);
  }
  return json?.data ?? json;
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

chrome.action.onClicked.addListener(async () => {
  try {
    await chrome.runtime.openOptionsPage();
  } catch {
    // ignore
  }
});

// ============================================
// 启动
// ============================================

init();