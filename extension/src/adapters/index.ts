/**
 * 适配器工厂
 * 根据平台返回对应的适配器实例
 */

import { BaseAdapter } from './base';
import { ChatGPTAdapter } from './chatgpt';
import { ClaudeAdapter } from './claude';
import { GeminiAdapter } from './gemini';
import { SupportedPlatform } from '../types';
import { detectPlatform } from '../core/platforms';

// 适配器缓存
const adapterCache = new Map<SupportedPlatform, BaseAdapter>();

/**
 * 获取当前平台的适配器
 */
export function getAdapter(platform?: SupportedPlatform): BaseAdapter | null {
  const p = platform || detectPlatform();
  
  // 检查缓存
  if (adapterCache.has(p)) {
    return adapterCache.get(p)!;
  }
  
  // 创建适配器
  let adapter: BaseAdapter | null = null;
  
  switch (p) {
    case 'chatgpt':
      adapter = new ChatGPTAdapter();
      break;
    case 'claude':
      adapter = new ClaudeAdapter();
      break;
    case 'gemini':
      adapter = new GeminiAdapter();
      break;
    case 'poe':
      // Poe 可以使用通用适配器或 ChatGPT 适配器
      adapter = new ChatGPTAdapter();
      break;
    default:
      console.warn('[ShadowThreads] Unknown platform:', p);
      return null;
  }
  
  // 缓存
  adapterCache.set(p, adapter);
  
  return adapter;
}

/**
 * 清除适配器缓存
 */
export function clearAdapterCache(): void {
  adapterCache.clear();
}

// 导出所有适配器
export { BaseAdapter } from './base';
export { ChatGPTAdapter } from './chatgpt';
export { ClaudeAdapter } from './claude';
export { GeminiAdapter } from './gemini';
