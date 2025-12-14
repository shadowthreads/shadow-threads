/**
 * 选择引擎
 * 处理文本选择、高亮和工具栏
 */

import { ConversationMessage } from '../types';

// ============================================
// 状态
// ============================================

interface SelectionState {
  text: string;
  range: Range | null;
  parentMessage: ConversationMessage | null;
  isToolbarVisible: boolean;
}

let state: SelectionState = {
  text: '',
  range: null,
  parentMessage: null,
  isToolbarVisible: false
};

let toolbarElement: HTMLElement | null = null;
let highlightElement: HTMLElement | null = null;

// 回调函数
let onSelectionCallback: ((text: string, message: ConversationMessage | null) => void) | null = null;

// ============================================
// 初始化
// ============================================

/**
 * 初始化选择引擎
 */
export function initSelectionEngine(
  onSelection: (text: string, message: ConversationMessage | null) => void
): void {
  onSelectionCallback = onSelection;
  
  // 创建工具栏
  createToolbar();
  
  // 监听选择事件
  document.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('keyup', handleKeyUp);
  
  // 点击其他地方时隐藏工具栏
  document.addEventListener('mousedown', handleMouseDown);
  
  console.log('[ShadowThreads] Selection engine initialized');
}

/**
 * 创建选择工具栏
 */
function createToolbar(): void {
  if (document.getElementById('st-selection-toolbar')) {
    toolbarElement = document.getElementById('st-selection-toolbar');
    return;
  }
  
  toolbarElement = document.createElement('div');
  toolbarElement.id = 'st-selection-toolbar';
  toolbarElement.className = 'st-selection-toolbar';
  toolbarElement.innerHTML = `
    <button class="st-toolbar-btn st-toolbar-main" id="st-toolbar-ask">
      <span class="st-toolbar-icon">🌙</span>
      <span class="st-toolbar-text">影子追问</span>
    </button>
    <button class="st-toolbar-btn st-toolbar-copy" id="st-toolbar-copy" title="复制">
      📋
    </button>
  `;
  
  document.body.appendChild(toolbarElement);
  
  // 绑定事件
  document.getElementById('st-toolbar-ask')?.addEventListener('click', handleToolbarAsk);
  document.getElementById('st-toolbar-copy')?.addEventListener('click', handleToolbarCopy);
}

// ============================================
// 事件处理
// ============================================

/**
 * 处理鼠标抬起
 */
function handleMouseUp(e: MouseEvent): void {
  // 忽略工具栏内的点击
  if (toolbarElement?.contains(e.target as Node)) {
    return;
  }
  
  // 延迟处理，等待选择完成
  setTimeout(() => {
    processSelection(e);
  }, 10);
}

/**
 * 处理键盘抬起（支持 Shift + 方向键选择）
 */
function handleKeyUp(e: KeyboardEvent): void {
  if (e.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    setTimeout(() => {
      processSelection();
    }, 10);
  }
}

/**
 * 处理鼠标按下
 */
function handleMouseDown(e: MouseEvent): void {
  // 如果点击在工具栏外，隐藏工具栏
  if (!toolbarElement?.contains(e.target as Node)) {
    hideToolbar();
  }
}

/**
 * 处理选择
 */
function processSelection(e?: MouseEvent): void {
  const selection = window.getSelection();
  
  if (!selection || selection.isCollapsed) {
    hideToolbar();
    return;
  }
  
  const text = selection.toString().trim();
  
  if (text.length < 2) {
    hideToolbar();
    return;
  }
  
  // 检查是否在消息元素内
  const range = selection.getRangeAt(0);
  const parentMessage = findParentMessage(range.commonAncestorContainer);
  
  // 更新状态
  state.text = text;
  state.range = range;
  state.parentMessage = parentMessage;
  
  // 显示工具栏
  showToolbar(range);
}

/**
 * 查找父消息元素
 */
function findParentMessage(node: Node): ConversationMessage | null {
  let current: Node | null = node;
  
  while (current && current !== document.body) {
    if (current instanceof HTMLElement) {
      // 检查是否有 data-st-processed 标记
      if (current.hasAttribute('data-st-processed')) {
        // 这是一个消息元素
        const role = current.getAttribute('data-message-author-role');
        const content = current.textContent || '';
        
        return {
          id: current.getAttribute('data-message-id') || `msg-${Date.now()}`,
          role: role === 'user' ? 'user' : 'assistant',
          content,
          element: current,
          platform: 'unknown' // 会被实际平台覆盖
        };
      }
      
      // 检查常见的消息容器类名
      const classList = current.className.toLowerCase();
      if (classList.includes('message') || 
          classList.includes('prose') || 
          classList.includes('markdown')) {
        return {
          id: `msg-${Date.now()}`,
          role: 'assistant', // 默认假设是助手消息
          content: current.textContent || '',
          element: current,
          platform: 'unknown'
        };
      }
    }
    
    current = current.parentNode;
  }
  
  return null;
}

// ============================================
// 工具栏操作
// ============================================

/**
 * 显示工具栏
 */
function showToolbar(range: Range): void {
  if (!toolbarElement) return;
  
  const rect = range.getBoundingClientRect();
  
  // 计算位置
  const top = rect.top - 45 + window.scrollY;
  const left = rect.left + (rect.width / 2) - 75 + window.scrollX;
  
  // 确保不超出视口
  const maxLeft = window.innerWidth - 160;
  const adjustedLeft = Math.max(10, Math.min(left, maxLeft));
  
  toolbarElement.style.top = `${Math.max(10, top)}px`;
  toolbarElement.style.left = `${adjustedLeft}px`;
  toolbarElement.classList.add('st-toolbar-visible');
  
  state.isToolbarVisible = true;
}

/**
 * 隐藏工具栏
 */
function hideToolbar(): void {
  if (!toolbarElement) return;
  
  toolbarElement.classList.remove('st-toolbar-visible');
  state.isToolbarVisible = false;
}

/**
 * 处理"影子追问"按钮点击
 */
function handleToolbarAsk(): void {
  if (state.text && onSelectionCallback) {
    onSelectionCallback(state.text, state.parentMessage);
  }
  hideToolbar();
  clearSelection();
}

/**
 * 处理"复制"按钮点击
 */
function handleToolbarCopy(): void {
  if (state.text) {
    navigator.clipboard.writeText(state.text).then(() => {
      // 显示复制成功提示
      showCopyToast();
    });
  }
  hideToolbar();
}

/**
 * 显示复制成功提示
 */
function showCopyToast(): void {
  const toast = document.createElement('div');
  toast.className = 'st-copy-toast';
  toast.textContent = '已复制';
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('st-copy-toast-fade');
    setTimeout(() => toast.remove(), 300);
  }, 1500);
}

/**
 * 清除选择
 */
function clearSelection(): void {
  window.getSelection()?.removeAllRanges();
  state.text = '';
  state.range = null;
  state.parentMessage = null;
}

// ============================================
// 高亮功能
// ============================================

/**
 * 高亮选中文本
 */
export function highlightSelection(): void {
  if (!state.range) return;
  
  // 移除之前的高亮
  removeHighlight();
  
  // 创建高亮元素
  highlightElement = document.createElement('span');
  highlightElement.className = 'st-highlight';
  
  try {
    state.range.surroundContents(highlightElement);
  } catch (e) {
    // 如果选择跨越多个元素，无法使用 surroundContents
    console.warn('[ShadowThreads] Cannot highlight complex selection');
  }
}

/**
 * 移除高亮
 */
export function removeHighlight(): void {
  if (highlightElement && highlightElement.parentNode) {
    const parent = highlightElement.parentNode;
    while (highlightElement.firstChild) {
      parent.insertBefore(highlightElement.firstChild, highlightElement);
    }
    parent.removeChild(highlightElement);
    highlightElement = null;
  }
}

// ============================================
// 导出
// ============================================

/**
 * 获取当前选择
 */
export function getCurrentSelection(): { text: string; message: ConversationMessage | null } {
  return {
    text: state.text,
    message: state.parentMessage
  };
}

/**
 * 销毁选择引擎
 */
export function destroySelectionEngine(): void {
  document.removeEventListener('mouseup', handleMouseUp);
  document.removeEventListener('keyup', handleKeyUp);
  document.removeEventListener('mousedown', handleMouseDown);
  
  toolbarElement?.remove();
  removeHighlight();
  
  onSelectionCallback = null;
}
