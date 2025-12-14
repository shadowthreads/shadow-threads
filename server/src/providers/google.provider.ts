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

console.log('[Google] Using SOCKS5 proxy:', SOCKS_PROXY);

export class GoogleProvider implements ILLMProvider {
  async complete(
    messages: LLMMessage[],
    model: string,
    apiKey: string
  ): Promise<LLMCompletionResponse> {
    try {
      const systemMessage = messages.find(m => m.role === 'system');
      const chatMessages = messages.filter(m => m.role !== 'system');

      const contents = chatMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          contents,
          systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
          generationConfig: {
            maxOutputTokens: 4096,
            temperature: 0.7
          }
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          httpsAgent: agent,
          proxy: false,
          timeout: 120000
        }
      );

      const data = response.data;
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text || '';

      return {
        content: text,
        model,
        promptTokens: data.usageMetadata?.promptTokenCount,
        completionTokens: data.usageMetadata?.candidatesTokenCount,
        finishReason: candidate?.finishReason || undefined
      };
    } catch (error: any) {
      const errorMsg = error.response?.data?.error?.message || error.message || 'Google API call failed';
      console.error('[Google] Error:', errorMsg);
      throw new Error(errorMsg);
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
        {
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }]
        },
        {
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