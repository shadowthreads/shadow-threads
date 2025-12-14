/**
 * ChatGPT 平台适配器
 */

import { BaseAdapter } from './base';
import { ConversationMessage } from '../types';

export class ChatGPTAdapter extends BaseAdapter {
  constructor() {
    super('chatgpt');
  }
  
  getMessages(): ConversationMessage[] {
    const messages: ConversationMessage[] = [];
    const { selectors } = this.config;
    
    // 策略1: 使用 data-message-author-role 属性
    const containers = document.querySelectorAll(selectors.messageContainer);
    
    if (containers.length > 0) {
      containers.forEach((container, index) => {
        const element = container as HTMLElement;
        const roleAttr = element.getAttribute('data-message-author-role');
        
        if (!roleAttr) return;
        
        const role = roleAttr === 'user' ? 'user' : 
                     roleAttr === 'assistant' ? 'assistant' : null;
        
        if (!role) return;
        
        // 获取消息内容
        const contentEl = element.querySelector(selectors.messageContent);
        const content = (contentEl?.textContent || element.textContent || '').trim();
        
        if (content.length === 0) return;
        
        const id = this.generateMessageId(element, index, role);
        
        messages.push({
          id,
          role,
          content,
          element,
          platform: 'chatgpt'
        });
      });
      
      return messages;
    }
    
    // 策略2: 备用 - 查找 article 或其他容器
    const articles = document.querySelectorAll('article, [data-testid*="conversation-turn"]');
    
    articles.forEach((article, index) => {
      const element = article as HTMLElement;
      const content = (element.textContent || '').trim();
      
      if (content.length === 0) return;
      
      // 通过位置或其他特征判断角色
      const role = this.detectRoleFromElement(element, index);
      const id = this.generateMessageId(element, index, role);
      
      messages.push({
        id,
        role,
        content,
        element,
        platform: 'chatgpt'
      });
    });
    
    return messages;
  }
  
  /**
   * 从元素特征检测角色
   */
  private detectRoleFromElement(element: HTMLElement, index: number): 'user' | 'assistant' {
    // 检查是否有 GPT 图标或标识
    const hasGptIndicator = element.querySelector('[class*="gpt"], [class*="agent"]');
    if (hasGptIndicator) return 'assistant';
    
    // 检查是否有用户头像
    const hasUserAvatar = element.querySelector('[class*="user"], [class*="human"]');
    if (hasUserAvatar) return 'user';
    
    // 默认通过索引判断（奇偶交替）
    return index % 2 === 0 ? 'user' : 'assistant';
  }
}
