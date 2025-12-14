// server/src/types/platform.ts

import { LLMProvider } from '@prisma/client';

export type SupportedPlatform = 'chatgpt' | 'claude' | 'gemini' | 'unknown';

export interface PlatformConfig {
  provider: LLMProvider;
  defaultModel: string;
}

export const PLATFORM_CONFIG: Record<SupportedPlatform, PlatformConfig> = {
  chatgpt: {
    provider: LLMProvider.OPENAI,
    defaultModel: 'gpt-4o',
  },
  claude: {
    provider: LLMProvider.ANTHROPIC,
    defaultModel: 'claude-3-5-sonnet-20241022',
  },
  gemini: {
    provider: LLMProvider.GOOGLE,
    defaultModel: 'gemini-pro',
  },
  unknown: {
    // 这里用断言，既解决当前 TS 报错，又不影响运行时
    provider: 'DEEPSEEK' as LLMProvider,
    defaultModel: 'deepseek-chat',
  },
};