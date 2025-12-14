/**
 * Gemini 平台适配器
 */

import { BaseAdapter } from './base';
import { ConversationMessage } from '../types';

export class GeminiAdapter extends BaseAdapter {
  constructor() {
    super('gemini');
  }
  
  getMessages(): ConversationMessage[] {
    const messages: ConversationMessage[] = [];
    
    // Gemini 的 DOM 结构
    // 策略1: 查找 model-response 和 user-query 元素
    const modelResponses = document.querySelectorAll('model-response, [class*="model-response"]');
    const userQueries = document.querySelectorAll('user-query, [class*="user-query"]');
    
    // 合并并按 DOM 顺序排序
    const allElements: Array<{element: Element; role: 'user' | 'assistant'}> = [];
    
    userQueries.forEach(el => {
      allElements.push({ element: el, role: 'user' });
    });
    
    modelResponses.forEach(el => {
      allElements.push({ element: el, role: 'assistant' });
    });
    
    // 按 DOM 位置排序
    allElements.sort((a, b) => {
      const position = a.element.compareDocumentPosition(b.element);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    
    if (allElements.length > 0) {
      allElements.forEach((item, index) => {
        const element = item.element as HTMLElement;
        const content = this.extractContent(element);
        
        if (content.length === 0) return;
        
        const id = this.generateMessageId(element, index, item.role);
        
        messages.push({
          id,
          role: item.role,
          content,
          element,
          platform: 'gemini'
        });
      });
      
      return messages;
    }
    
    // 策略2: 查找通用消息容器
    const containers = document.querySelectorAll(
      '[class*="conversation-container"] > div, ' +
      '[class*="chat-message"], ' +
      '[class*="message-content"]'
    );
    
    containers.forEach((container, index) => {
      const element = container as HTMLElement;
      const content = (element.textContent || '').trim();
      
      if (content.length === 0) return;
      
      const role = index % 2 === 0 ? 'user' : 'assistant';
      const id = this.generateMessageId(element, index, role);
      
      messages.push({
        id,
        role,
        content,
        element,
        platform: 'gemini'
      });
    });
    
    return messages;
  }
  
  /**
   * 提取消息内容
   */
  private extractContent(element: HTMLElement): string {
    // 尝试找到 markdown 内容
    const markdownEl = element.querySelector(
      '.markdown-content, ' +
      '[class*="markdown"], ' +
      '.response-content, ' +
      '.query-content'
    );
    
    if (markdownEl) {
      return (markdownEl.textContent || '').trim();
    }
    
    return (element.textContent || '').trim();
  }
}
