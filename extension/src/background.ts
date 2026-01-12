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
  SubthreadListItem,
  PinSnapshotRequest,
  PinSnapshotResponse,
  PinSnapshotError,
  ApplySnapshotRequest,
  ApplySnapshotResult,
  ApplySnapshotError
} from './types';


// ============================================
// 配置
// ============================================

let serverUrl = DEFAULT_SETTINGS.serverUrl;
let deviceId = '';
// ✅ MV3: service worker 可能被重启，处理消息时 deviceId 可能尚未加载
let settingsReadyPromise: Promise<void> | null = null;

async function ensureDeviceReady(): Promise<void> {
  if (deviceId && deviceId.trim()) return;

  if (!settingsReadyPromise) {
    settingsReadyPromise = (async () => {
      try {
        const result = await chrome.storage.local.get(['serverUrl', 'deviceId']);

        if (result.serverUrl) serverUrl = result.serverUrl;

        if (result.deviceId) {
          deviceId = result.deviceId;
        } else {
          deviceId = generateDeviceId();
          await chrome.storage.local.set({ deviceId });
        }
      } catch (e) {
        console.error('[ShadowThreads BG] ensureDeviceReady failed:', e);
        // 兜底：保证不为空
        if (!deviceId || !deviceId.trim()) deviceId = generateDeviceId();
        try { await chrome.storage.local.set({ deviceId }); } catch { /* ignore */ }
      }
    })().finally(() => {
      settingsReadyPromise = null;
    });
  }

  await settingsReadyPromise;

  if (!deviceId || !deviceId.trim()) {
    deviceId = generateDeviceId();
    try { await chrome.storage.local.set({ deviceId }); } catch { /* ignore */ }
  }
}

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
// ✅ MV3 Keep-Alive：接收 content.ts 的长连接（不影响主链路）
// ============================================

chrome.runtime.onConnect.addListener((port) => {
  try {
    if (port.name !== 'st-keepalive') return;

    port.onMessage.addListener((msg) => {
      // content 端会定时 post {type:'PING'}
      // 这里不用回任何东西，保持连接即可
      if (msg?.type === 'PING') {
        // no-op
      }
    });

    port.onDisconnect.addListener(() => {
      // no-op
    });

    console.log('[ShadowThreads BG] KeepAlive port connected');
  } catch {
    // ignore
  }
});

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

    // ✅ 新增：用户手动 Pin 一个 snapshot 起点
    case 'PIN_SNAPSHOT': {
      handlePinSnapshot(message.data as PinSnapshotRequest, tabId, requestId);
      sendResponse({ received: true, requestId });
      return false;
    }

    // ✅ Phase 1.5：Apply Snapshot（中性语义：应用 snapshot 信息核心）
    case 'APPLY_SNAPSHOT': {
      handleApplySnapshot(message.data as ApplySnapshotRequest, tabId, requestId);
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
  await ensureDeviceReady();

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
    console.error('[ShadowThreads BG] Request failed:', {
      serverUrl,
      deviceId,
      error: error instanceof Error ? error.message : String(error)
    });

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
  await ensureDeviceReady();

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

// ============================================
// ✅ 新增：Pin Snapshot（用户手动创建 snapshot 起点）
// ============================================

async function handlePinSnapshot(
  data: PinSnapshotRequest,
  tabId?: number,
  requestId?: string
) {
  console.log('[ShadowThreads BG] Pin snapshot...', { requestId, tabId });
  await ensureDeviceReady();

  if (tabId == null) {
    console.error('[ShadowThreads BG] Missing tabId for PIN_SNAPSHOT, cannot deliver response.', {
      requestId,
      subthreadId: (data as any)?.subthreadId
    });
    return;
  }

  const subthreadId = String(data?.subthreadId || '').trim();
  if (!subthreadId) {
    await sendToTab(tabId, {
      type: 'PIN_SNAPSHOT_ERROR',
      requestId,
      data: { error: 'missing subthreadId' } satisfies PinSnapshotError
    });
    return;
  }

  // ✅ 记录 lastRequest（旁路观察，不影响功能）
  lastRequest = {
    requestId: requestId || `no-rid-${Date.now()}`,
    kind: 'PIN_SNAPSHOT',
    startedAt: Date.now(),
    tabId
  };

  try {
    const response = await fetch(`${serverUrl}/api/v1/subthreads/${subthreadId}/snapshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': deviceId,
        ...(requestId ? { 'X-Request-ID': requestId } : {})
      }
    });

    let result: any = null;
    try {
      result = await response.json();
    } catch {
      const msg = `服务器返回非 JSON 响应（HTTP ${response.status}）`;
      await sendToTab(tabId, {
        type: 'PIN_SNAPSHOT_ERROR',
        requestId,
        data: { error: msg } satisfies PinSnapshotError
      });
      finalizeLastRequest(false, msg, response.status, undefined);
      return;
    }

    if (result?.success) {
      await sendToTab(tabId, {
        type: 'PIN_SNAPSHOT_RESPONSE',
        requestId,
        data: (result.data || {}) as PinSnapshotResponse
      });

      finalizeLastRequest(true, undefined, response.status, undefined);
    } else {
      const errMsg = result?.error?.message || `请求失败（HTTP ${response.status}）`;
      await sendToTab(tabId, {
        type: 'PIN_SNAPSHOT_ERROR',
        requestId,
        data: { error: errMsg } satisfies PinSnapshotError
      });

      finalizeLastRequest(false, errMsg, response.status, undefined);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Network error';
    console.error('[ShadowThreads BG] PIN_SNAPSHOT failed:', error);

    await sendToTab(tabId, {
      type: 'PIN_SNAPSHOT_ERROR',
      requestId,
      data: { error: msg } satisfies PinSnapshotError
    });

    finalizeLastRequest(false, msg, undefined, undefined);
  }
}

// ============================================
// ✅ Phase 1.5：Apply Snapshot（把 snapshot 作为“信息核心”应用）
// 当前实现：调用后端 state-snapshots/:id/continue，并把结果包装为 APPLY_SNAPSHOT_RESULT
// ============================================

async function handleApplySnapshot(
  data: ApplySnapshotRequest,
  tabId?: number,
  requestId?: string
) {
  console.log('[ShadowThreads BG] Apply snapshot...', { requestId, tabId });
  await ensureDeviceReady();

  if (tabId == null) {
    console.error('[ShadowThreads BG] Missing tabId for APPLY_SNAPSHOT, cannot deliver response.');
    return;
  }

  const snapshotId = String(data?.snapshotId || '').trim();
  if (!snapshotId) {
    await sendToTab(tabId, {
      type: 'APPLY_SNAPSHOT_ERROR',
      requestId,
      data: { error: 'missing snapshotId' } satisfies ApplySnapshotError
    });
    return;
  }

  const userQuestion = typeof data?.intent === 'string' ? data.intent.trim() : '';
  if (!userQuestion) {
    await sendToTab(tabId, {
      type: 'APPLY_SNAPSHOT_ERROR',
      requestId,
      data: { error: 'missing userQuestion (intent)' } satisfies ApplySnapshotError
    });
    return;
  }

  lastRequest = {
    requestId: requestId || `no-rid-${Date.now()}`,
    kind: 'PIN_SNAPSHOT', // 不新增 kind，避免扩大面；这里只做旁路观察
    startedAt: Date.now(),
    tabId
  };

  try {
    const response = await fetch(`${serverUrl}/api/v1/state-snapshots/${snapshotId}/continue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': deviceId,
        ...(requestId ? { 'X-Request-ID': requestId } : {})
      },
      // intent/providerHint/modelHint 预留：后端未来可以接；现在不传也没问题
      body: JSON.stringify({
        userQuestion
      })
    });

    let result: any = null;
    try {
      result = await response.json();
    } catch {
      const msg = `服务器返回非 JSON 响应（HTTP ${response.status}）`;
      await sendToTab(tabId, {
        type: 'APPLY_SNAPSHOT_ERROR',
        requestId,
        data: { error: msg } satisfies ApplySnapshotError
      });
      return;
    }

    if (result?.success) {
      const payload: ApplySnapshotResult = {
        appliedSnapshotId: snapshotId,
        outcome: 'NEW_THREAD',
        subthreadResponse: result.data
      };

      await sendToTab(tabId, {
        type: 'APPLY_SNAPSHOT_RESULT',
        requestId,
        data: payload
      });
    } else {
      const errMsg = result?.error?.message || `请求失败（HTTP ${response.status}）`;
      await sendToTab(tabId, {
        type: 'APPLY_SNAPSHOT_ERROR',
        requestId,
        data: { error: errMsg } satisfies ApplySnapshotError
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Network error';
    console.error('[ShadowThreads BG] APPLY_SNAPSHOT failed:', error);

    await sendToTab(tabId, {
      type: 'APPLY_SNAPSHOT_ERROR',
      requestId,
      data: { error: msg } satisfies ApplySnapshotError
    });
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