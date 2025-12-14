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

const SOCKS_PROXY = 'socks5://127.0.0.1:4781';
const agent = new SocksProxyAgent(SOCKS_PROXY);

console.log('[Anthropic] Using SOCKS5 proxy:', SOCKS_PROXY);

export class AnthropicProvider implements ILLMProvider {
  async complete(
    messages: LLMMessage[],
    model: string,
    apiKey: string
  ): Promise<LLMCompletionResponse> {
    try {
      const systemMessage = messages.find(m => m.role === 'system');
      const chatMessages = messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content
        }));

      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model,
          max_tokens: 4096,
          system: systemMessage?.content,
          messages: chatMessages
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          httpsAgent: agent,
          proxy: false,
          timeout: 120000
        }
      );

      const data = response.data;
      const textContent = data.content.find((c: any) => c.type === 'text');

      return {
        content: textContent?.text || '',
        model: data.model,
        promptTokens: data.usage?.input_tokens,
        completionTokens: data.usage?.output_tokens,
        finishReason: data.stop_reason || undefined
      };
    } catch (error: any) {
      const errorMsg = error.response?.data?.error?.message || error.message || 'Anthropic API call failed';
      console.error('[Anthropic] Error:', errorMsg);
      throw new Error(errorMsg);
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }]
        },
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          httpsAgent: agent,
          proxy: false,
          timeout: 30000
        }
      );
      return true;
    } catch {
      return false;
    }
  }
}