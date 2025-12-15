import type {
  BackendHealthStatus,
  DebugStatus,
  SubthreadListItem
} from './types';

function $(id: string) {
  return document.getElementById(id) as HTMLElement | null;
}

function setText(id: string, text: string) {
  const el = $(id);
  if (el) el.textContent = text;
}

function setHtml(id: string, html: string) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

function setPill(pillEl: HTMLElement, ok: boolean) {
  pillEl.classList.remove('ok', 'bad');
  pillEl.classList.add(ok ? 'ok' : 'bad');
  pillEl.textContent = ok ? 'ok' : 'fail';
}

function safeJson(obj: any) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

async function sendMsg<T = any>(type: string, data?: any): Promise<T> {
  return await chrome.runtime.sendMessage({ type, data });
}

async function loadSettingsToUI() {
  const result = await chrome.storage.local.get(['serverUrl', 'deviceId']);
  const serverUrlInput = $('serverUrl') as HTMLInputElement | null;
  const deviceIdInput = $('deviceId') as HTMLInputElement | null;

  if (serverUrlInput) serverUrlInput.value = result.serverUrl || 'http://localhost:3001';
  if (deviceIdInput) deviceIdInput.value = result.deviceId || '';
}

async function saveSettingsFromUI() {
  const serverUrlInput = $('serverUrl') as HTMLInputElement | null;
  const hint = $('saveHint');

  const serverUrl = (serverUrlInput?.value || '').trim();
  if (!serverUrl) {
    if (hint) hint.textContent = 'serverUrl 不能为空';
    return;
  }

  // 存储 + 通知 BG 刷新 serverUrl 变量
  await chrome.storage.local.set({ serverUrl });
  await sendMsg('SAVE_SETTINGS', { serverUrl });

  if (hint) {
    hint.textContent = '已保存';
    setTimeout(() => {
      if (hint) hint.textContent = '';
    }, 1500);
  }
}

async function checkBackendHealth() {
  const pill = $('healthPill');
  const text = $('healthText');
  if (!pill || !text) return;

  setText('healthText', 'checking...');
  pill.textContent = '...';

  const res: any = await sendMsg('CHECK_BACKEND_HEALTH');
  const status: BackendHealthStatus = res?.data;

  if (!status) {
    setPill(pill, false);
    setText('healthText', 'no response');
    return;
  }

  setPill(pill, !!status.ok);
  setText('healthText', safeJson(status));
}

async function refreshDebug() {
  const debugText = $('debugText');
  if (!debugText) return;

  const res: any = await sendMsg('GET_DEBUG_STATUS');
  const status: DebugStatus = res?.data;

  if (!status) {
    debugText.textContent = 'no debug status';
    return;
  }

  debugText.textContent = safeJson(status);
}

function renderHistoryRows(items: SubthreadListItem[]) {
  const tbody = $('historyTbody');
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = `<tr><td class="muted" colspan="6">暂无历史记录</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map((x) => {
    const id = x.id || '';
    const providerModel = `${x.provider || '-'} / ${x.model || '-'}`;
    const platform = x.platform || '-';
    const selection = (x.selectionText || '').replace(/\s+/g, ' ').slice(0, 120);
    const time = x.createdAt ? new Date(x.createdAt).toLocaleString() : (x.updatedAt ? new Date(x.updatedAt).toLocaleString() : '-');

    return `
      <tr>
        <td class="cell-id"><span class="mono">${escapeHtml(id)}</span></td>
        <td>${escapeHtml(providerModel)}</td>
        <td>${escapeHtml(platform)}</td>
        <td class="cell-snippet" title="${escapeHtml(x.selectionText || '')}">${escapeHtml(selection)}</td>
        <td>${escapeHtml(time)}</td>
        <td><button class="secondary btn-mini" data-action="view" data-id="${escapeAttr(id)}">查看</button></td>
      </tr>
    `;
  }).join('');
}

async function refreshHistory() {
  const hint = $('historyHint');
  if (hint) hint.textContent = 'loading...';

  try {
    const res: any = await sendMsg('FETCH_SUBTHREADS', { limit: 50 });
    const items: SubthreadListItem[] = res?.data || [];
    renderHistoryRows(items);

    if (hint) hint.textContent = `共 ${items.length} 条`;
  } catch (e: any) {
    if (hint) hint.textContent = `加载失败：${e?.message || String(e)}`;
  }
}

async function viewDetail(subthreadId: string) {
  const box = $('detailBox') as HTMLTextAreaElement | null;
  if (!box) return;

  box.value = 'loading...';

  try {
    const res: any = await sendMsg('FETCH_SUBTHREAD_DETAIL', { subthreadId });
    box.value = safeJson(res?.data ?? res);
  } catch (e: any) {
    box.value = `加载失败：${e?.message || String(e)}`;
  }
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function bindEvents() {
  $('saveBtn')?.addEventListener('click', () => {
    saveSettingsFromUI().catch(console.error);
  });

  $('reloadBtn')?.addEventListener('click', () => {
    loadSettingsToUI().catch(console.error);
    refreshDebug().catch(console.error);
  });

  $('healthBtn')?.addEventListener('click', () => {
    checkBackendHealth().catch(console.error);
  });

  $('refreshDebugBtn')?.addEventListener('click', () => {
    refreshDebug().catch(console.error);
  });

  $('refreshHistoryBtn')?.addEventListener('click', () => {
    refreshHistory().catch(console.error);
  });

  $('copyDetailBtn')?.addEventListener('click', async () => {
    const box = $('detailBox') as HTMLTextAreaElement | null;
    if (!box) return;
    try {
      await navigator.clipboard.writeText(box.value || '');
    } catch {
      // fallback
      box.select();
      document.execCommand('copy');
    }
  });

  // Table event delegation
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.getAttribute('data-action') === 'view') {
      const id = target.getAttribute('data-id') || '';
      if (id) viewDetail(id).catch(console.error);
    }
  });
}

async function main() {
  await loadSettingsToUI();
  bindEvents();

  // 初始拉一次 Debug（不影响任何链路）
  await refreshDebug();
}

main().catch(console.error);