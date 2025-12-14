/**
 * Claude 平台适配器
 */

import { BaseAdapter } from './base';
import { ConversationMessage } from '../types';

export class ClaudeAdapter extends BaseAdapter {
  constructor() {
    super('claude');
  }
  
  getMessages(): ConversationMessage[] {
    const messages: ConversationMessage[] = [];
    
    // Claude 的 DOM 结构可能会变化，这里提供多种策略
    
    // 策略1: 查找对话回合容器
    const turns = document.querySelectorAll(
      '[data-testid="conversation-turn"], ' +
      '.font-claude-message, ' +
      '[class*="ConversationMessage"], ' +
      '[class*="message-row"]'
    );
    
    if (turns.length > 0) {
      turns.forEach((turn, index) => {
        const element = turn as HTMLElement;
        const message = this.parseClaudeMessage(element, index);
        if (message) {
          messages.push(message);
        }
      });
      
      return messages;
    }
    
    // 策略2: 查找 prose 容器
    const proseElements = document.querySelectorAll('.prose');
    
    proseElements.forEach((prose, index) => {
      const element = prose as HTMLElement;
      const content = (element.textContent || '').trim();
      
      if (content.length === 0) return;
      
      // 判断角色
      const role = this.detectRoleFromContext(element, index);
      const id = this.generateMessageId(element, index, role);
      
      messages.push({
        id,
        role,
        content,
        element,
        platform: 'claude'
      });
    });
    
    return messages;
  }
  
  /**
   * 解析 Claude 消息元素
   */
  private parseClaudeMessage(element: HTMLElement, index: number): ConversationMessage | null {
    // 检测角色
    const isHuman = element.querySelector('[class*="human"], [class*="Human"]') !== null ||
                    element.classList.toString().toLowerCase().includes('human') ||
                    element.getAttribute('data-is-human') === 'true';
    
    const isAssistant = element.querySelector('[class*="assistant"], [class*="claude"]') !== null ||
                        element.classList.toString().toLowerCase().includes('assistant') ||
                        element.getAttribute('data-is-assistant') === 'true';
    
    let role: 'user' | 'assistant';
    if (isHuman) {
      role = 'user';
    } else if (isAssistant) {
      role = 'assistant';
    } else {
      // 通过索引判断
      role = index % 2 === 0 ? 'user' : 'assistant';
    }
    
    // 获取内容
    const contentEl = element.querySelector('.prose, [class*="markdown"], [class*="content"]');
    const content = (contentEl?.textContent || element.textContent || '').trim();
    
    if (content.length === 0) return null;
    
    const id = this.generateMessageId(element, index, role);
    
    return {
      id,
      role,
      content,
      element,
      platform: 'claude'
    };
  }
  
  /**
   * 从上下文检测角色
   */
  private detectRoleFromContext(element: HTMLElement, index: number): 'user' | 'assistant' {
    // 检查父元素
    const parent = element.closest('[class*="human"], [class*="Human"]');
    if (parent) return 'user';
    
    const assistantParent = element.closest('[class*="assistant"], [class*="claude"]');
    if (assistantParent) return 'assistant';
    
    // 检查相邻元素的图标
    const prevSibling = element.previousElementSibling;
    if (prevSibling) {
      const hasHumanIcon = prevSibling.querySelector('[class*="human"], [class*="user"]');
      if (hasHumanIcon) return 'user';
      
      const hasClaudeIcon = prevSibling.querySelector('[class*="claude"], [class*="assistant"]');
      if (hasClaudeIcon) return 'assistant';
    }
    
    return index % 2 === 0 ? 'user' : 'assistant';
  }
}
