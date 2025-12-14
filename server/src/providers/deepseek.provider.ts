// server/src/providers/deepseek.provider.ts

import axios from 'axios';
import { ILLMProvider } from '../services/llm.service';

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMCompletionResponse {
  content: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
}

// DeepSeek API 基础地址（注意带 v1）
const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

export class DeepSeekProvider implements ILLMProvider {
  /**
   * 调用 DeepSeek 完成对话
   */
  async complete(
    messages: LLMMessage[],
    model: string,
    apiKey: string
  ): Promise<LLMCompletionResponse> {
    try {
      // 转成 OpenAI 兼容格式
      const payload = {
        model: model || 'deepseek-chat',
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        max_tokens: 2048,
        temperature: 0.7,
      };

      const response = await axios.post(
        `${DEEPSEEK_API_BASE}/chat/completions`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          // 不用任何代理，避免奇怪的重定向
          proxy: false,
          timeout: 60000,
          maxRedirects: 5,
        }
      );

      const data = response.data;
      const choice = data.choices?.[0];

      return {
        content: choice?.message?.content || '',
        model: data.model || model,
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        finishReason: choice?.finish_reason || undefined,
      };
    } catch (error: any) {
      const msg =
        error.response?.data?.error?.message ||
        error.message ||
        'DeepSeek API call failed';

      // 打一点日志，方便以后排查
      console.error('[DeepSeek] Error:', msg);
      if (error.response?.status) {
        console.error('[DeepSeek] Status:', error.response.status);
        console.error('[DeepSeek] Data:', error.response.data);
      }

      throw new Error(msg);
    }
  }

  /**
   * 校验 DeepSeek API Key（随便丢个 very small 请求）
   */
  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      await axios.post(
        `${DEEPSEEK_API_BASE}/chat/completions`,
        {
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          proxy: false,
          timeout: 10000,
          maxRedirects: 5,
        }
      );

      return true;
    } catch (error: any) {
      console.error('[DeepSeek] validate key failed:', error.message);
      return false;
    }
  }
}