/**
 * UI 模块统一导出
 */

export {
  initSidebar,
  openSidebar,
  closeSidebar,
  toggleSidebar,
  addMessage,
  handleSubthreadResponse,
  handleSubthreadError,
  resetSidebar,
  getSidebarState
} from './sidebar';

export {
  initSelectionEngine,
  getCurrentSelection,
  highlightSelection,
  removeHighlight,
  destroySelectionEngine
} from './selection';
