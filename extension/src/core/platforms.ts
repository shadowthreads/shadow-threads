/**
 * 平台配置
 * 定义各 LLM 平台的 URL 匹配规则和 DOM 选择器
 */

import { PlatformConfig, SupportedPlatform } from './types';

// ============================================
// ChatGPT 配置
// ============================================

const chatgptConfig: PlatformConfig = {
  platform: 'chatgpt',
  provider: 'OPENAI',
  defaultModel: 'gpt-4o',
  urlPatterns: [
    /^https:\/\/(chat\.openai\.com|chatgpt\.com)/
  ],
  selectors: {
    messageContainer: '[data-message-author-role]',
    userMessage: '[data-message-author-role="user"]',
    assistantMessage: '[data-message-author-role="assistant"]',
    messageContent: '.markdown, .prose, [class*="markdown"]',
    messageIdAttr: 'data-message-id'
  }
};

// ============================================
// Claude 配置
// ============================================

const claudeConfig: PlatformConfig = {
  platform: 'claude',
  provider: 'ANTHROPIC',
  defaultModel: 'claude-3-5-sonnet-20241022',
  urlPatterns: [
    /^https:\/\/claude\.ai/
  ],
  selectors: {
    // Claude 的 DOM 结构
    messageContainer: '[data-testid="conversation-turn"], .prose',
    userMessage: '[data-testid="user-message"], .human-message',
    assistantMessage: '[data-testid="assistant-message"], .assistant-message',
    messageContent: '.prose, .markdown-content, [class*="prose"]',
    messageIdAttr: 'data-message-id'
  }
};

// ============================================
// Gemini 配置
// ============================================

const geminiConfig: PlatformConfig = {
  platform: 'gemini',
  provider: 'GOOGLE',
  defaultModel: 'gemini-pro',
  urlPatterns: [
    /^https:\/\/gemini\.google\.com/
  ],
  selectors: {
    messageContainer: '.conversation-container message-content, model-response',
    userMessage: 'user-query, .user-message',
    assistantMessage: 'model-response, .model-response',
    messageContent: '.markdown-content, .response-content',
    messageIdAttr: 'data-message-id'
  }
};

// ============================================
// Poe 配置
// ============================================

const poeConfig: PlatformConfig = {
  platform: 'poe',
  provider: 'OPENAI', // 默认，实际取决于用户选择的 bot
  defaultModel: 'gpt-4o',
  urlPatterns: [
    /^https:\/\/poe\.com/
  ],
  selectors: {
    messageContainer: '[class*="Message_row"]',
    userMessage: '[class*="Message_humanMessage"]',
    assistantMessage: '[class*="Message_botMessage"]',
    messageContent: '[class*="Markdown_markdownContainer"]',
    messageIdAttr: 'data-message-id'
  }
};

// ============================================
// 所有平台配置
// ============================================

export const PLATFORM_CONFIGS: Record<SupportedPlatform, PlatformConfig> = {
  chatgpt: chatgptConfig,
  claude: claudeConfig,
  gemini: geminiConfig,
  poe: poeConfig,
  unknown: {
    platform: 'unknown',
    provider: 'OPENAI',
    defaultModel: 'gpt-4o',
    urlPatterns: [],
    selectors: {
      messageContainer: '',
      userMessage: '',
      assistantMessage: '',
      messageContent: ''
    }
  }
};

// ============================================
// 平台检测
// ============================================

/**
 * 根据 URL 检测当前平台
 */
export function detectPlatform(url: string = window.location.href): SupportedPlatform {
  for (const [platform, config] of Object.entries(PLATFORM_CONFIGS)) {
    if (platform === 'unknown') continue;
    
    for (const pattern of config.urlPatterns) {
      if (pattern.test(url)) {
        return platform as SupportedPlatform;
      }
    }
  }
  
  return 'unknown';
}

/**
 * 获取当前平台配置
 */
export function getPlatformConfig(platform?: SupportedPlatform): PlatformConfig {
  const p = platform || detectPlatform();
  return PLATFORM_CONFIGS[p] || PLATFORM_CONFIGS.unknown;
}
