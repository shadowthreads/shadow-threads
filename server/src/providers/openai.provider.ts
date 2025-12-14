import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
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

// 使用 SOCKS5 代理（你的代理软件 SOCKS 端口是 4781）
const SOCKS_PROXY = 'socks5://127.0.0.1:4781';
const agent = new SocksProxyAgent(SOCKS_PROXY);

console.log('[OpenAI] Using SOCKS5 proxy:', SOCKS_PROXY);

export class OpenAIProvider implements ILLMProvider {
  async complete(
    messages: LLMMessage[],
    model: string,
    apiKey: string
  ): Promise<LLMCompletionResponse> {
    console.log('[OpenAI] Calling API with model:', model);
    
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content
          })),
          max_tokens: 4096,
          temperature: 0.7
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          httpsAgent: agent,
          proxy: false,
          timeout: 120000
        }
      );

      console.log('[OpenAI] Success! Status:', response.status);
      
      const data = response.data;
      const choice = data.choices[0];

      return {
        content: choice.message.content || '',
        model: data.model,
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        finishReason: choice.finish_reason || undefined
      };
    } catch (error: any) {
      const errorMsg = error.response?.data?.error?.message || error.message || 'OpenAI API call failed';
      console.error('[OpenAI] Error:', errorMsg);
      throw new Error(errorMsg);
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      await axios.get('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        httpsAgent: agent,
        proxy: false,
        timeout: 30000
      });
      return true;
    } catch {
      return false;
    }
  }
}