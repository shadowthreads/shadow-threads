/**
 * 平台适配器基类
 * 定义所有平台适配器必须实现的接口
 */

import { ConversationMessage, SupportedPlatform, PlatformConfig } from '../types';
import { getPlatformConfig } from '../core/platforms';

export abstract class BaseAdapter {
  protected platform: SupportedPlatform;
  protected config: PlatformConfig;
  
  constructor(platform: SupportedPlatform) {
    this.platform = platform;
    this.config = getPlatformConfig(platform);
  }
  
  /**
   * 获取页面上所有消息
   */
  abstract getMessages(): ConversationMessage[];
  
  /**
   * 获取助手消息
   */
  getAssistantMessages(): ConversationMessage[] {
    return this.getMessages().filter(m => m.role === 'assistant');
  }
  
  /**
   * 获取用户消息
   */
  getUserMessages(): ConversationMessage[] {
    return this.getMessages().filter(m => m.role === 'user');
  }
  
  /**
   * 获取当前对话 ID
   */
  getConversationId(): string {
    return window.location.pathname;
  }
  
  /**
   * 获取当前对话 URL
   */
  getConversationUrl(): string {
    return window.location.href;
  }
  
  /**
   * 检查元素是否已经添加了 Shadow Threads 按钮
   */
  hasButton(element: HTMLElement): boolean {
    return element.querySelector('.st-shadow-btn') !== null ||
           element.hasAttribute('data-st-processed');
  }
  
  /**
   * 标记元素已处理
   */
  markProcessed(element: HTMLElement): void {
    element.setAttribute('data-st-processed', 'true');
  }
  
  /**
   * 生成消息 ID
   */
  protected generateMessageId(element: HTMLElement, index: number, role: string): string {
    // 尝试从元素属性获取 ID
    if (this.config.selectors.messageIdAttr) {
      const id = element.getAttribute(this.config.selectors.messageIdAttr);
      if (id) return id;
      
      // 尝试从父元素获取
      const parent = element.closest(`[${this.config.selectors.messageIdAttr}]`);
      if (parent) {
        const parentId = parent.getAttribute(this.config.selectors.messageIdAttr);
        if (parentId) return parentId;
      }
    }
    
    // 生成基于内容的 hash ID
    const content = element.textContent?.slice(0, 100) || '';
    const hash = this.simpleHash(content);
    return `${this.platform}_${role}_${index}_${hash}`;
  }
  
  /**
   * 简单的字符串哈希
   */
  protected simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}
