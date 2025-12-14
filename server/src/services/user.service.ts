/**
 * 用户业务服务
 */

import { LLMProvider } from '@prisma/client';
import { prisma, logger, encrypt, decrypt, config } from '../utils';
import { Errors, SaveApiKeyInput, UpdateSettingsInput } from '../middleware';
import { LLMService } from './llm.service';

export class UserService {
  private llmService = new LLMService();
  
  /**
   * 获取用户资料
   */
  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        settings: true,
        apiKeys: {
          select: {
            id: true,
            provider: true,
            label: true,
            isDefault: true,
            isValid: true,
            lastUsed: true,
            createdAt: true
          }
        }
      }
    });
    
    if (!user) {
      throw Errors.notFound('User');
    }
    
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      settings: user.settings ? {
        defaultProvider: user.settings.defaultProvider,
        theme: user.settings.theme,
        language: user.settings.language,
        autoSummarize: user.settings.autoSummarize,
        saveHistory: user.settings.saveHistory
      } : null,
      apiKeys: user.apiKeys.map(k => ({
        id: k.id,
        provider: k.provider,
        label: k.label,
        isDefault: k.isDefault,
        isValid: k.isValid,
        lastUsed: k.lastUsed,
        createdAt: k.createdAt
      }))
    };
  }
  
  /**
   * 更新用户设置
   */
  async updateSettings(userId: string, input: UpdateSettingsInput) {
    const settings = await prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        ...input
      },
      update: input
    });
    
    return {
      defaultProvider: settings.defaultProvider,
      theme: settings.theme,
      language: settings.language,
      autoSummarize: settings.autoSummarize,
      saveHistory: settings.saveHistory
    };
  }
  
  /**
   * 获取用户 API Keys 列表
   */
  async listApiKeys(userId: string) {
    const apiKeys = await prisma.userApiKey.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        label: true,
        isDefault: true,
        isValid: true,
        lastUsed: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    return apiKeys;
  }
  
  /**
   * 保存 API Key
   */
  async saveApiKey(userId: string, input: SaveApiKeyInput) {
    const { provider, apiKey, label, isDefault } = input;
    
    // 加密 API Key
    const encryptedKey = encrypt(apiKey);
    
    // 如果设为默认，先取消其他默认
    if (isDefault) {
      await prisma.userApiKey.updateMany({
        where: { userId, provider, isDefault: true },
        data: { isDefault: false }
      });
    }
    
    // 创建或更新
    const savedKey = await prisma.userApiKey.upsert({
      where: {
        userId_provider_label: {
          userId,
          provider,
          label: label || 'default'
        }
      },
      create: {
        userId,
        provider,
        encryptedKey,
        label: label || 'default',
        isDefault: isDefault ?? true,
        isValid: true
      },
      update: {
        encryptedKey,
        isDefault: isDefault ?? undefined,
        isValid: true,
        updatedAt: new Date()
      }
    });
    
    logger.info('API key saved', { userId, provider, keyId: savedKey.id });
    
    return {
      id: savedKey.id,
      provider: savedKey.provider,
      label: savedKey.label,
      isDefault: savedKey.isDefault
    };
  }
  
  /**
   * 删除 API Key
   */
  async deleteApiKey(userId: string, provider: LLMProvider, label?: string) {
    const result = await prisma.userApiKey.deleteMany({
      where: {
        userId,
        provider,
        ...(label && { label })
      }
    });
    
    if (result.count === 0) {
      throw Errors.apiKeyNotFound();
    }
    
    logger.info('API key deleted', { userId, provider });
  }
  
  /**
   * 验证 API Key
   */
  async validateApiKey(userId: string, provider: LLMProvider) {
    const apiKey = await this.getDecryptedApiKey(userId, provider);
    
    try {
      const isValid = await this.llmService.validateApiKey(provider, apiKey);
      
      // 更新验证状态
      await prisma.userApiKey.updateMany({
        where: { userId, provider },
        data: { isValid }
      });
      
      return { valid: isValid };
    } catch (error) {
      // 标记为无效
      await prisma.userApiKey.updateMany({
        where: { userId, provider },
        data: { isValid: false }
      });
      
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : 'Validation failed' 
      };
    }
  }
  
  /**
   * 获取解密后的 API Key
   * - 对 DEEPSEEK：优先使用全局环境变量，不要求用户单独配置
   * - 其它 Provider：优先使用用户自己的 Key，缺省时用系统默认 Key
   */
  async getDecryptedApiKey(userId: string, provider: LLMProvider): Promise<string> {
    // 🌟 1. DeepSeek 特殊处理：直接用全局 Key
    if (provider === 'DEEPSEEK') {
      const key = config.deepseekApiKey || process.env.DEEPSEEK_API_KEY;
      if (!key) {
        throw Errors.apiKeyNotFound();
      }
      return key;
    }

    // 🌟 2. 其它 Provider：先查找用户的 API Key
    const userKey = await prisma.userApiKey.findFirst({
      where: {
        userId,
        provider,
        isValid: true
      },
      orderBy: [
        { isDefault: 'desc' },
        { updatedAt: 'desc' }
      ]
    });
    
    if (userKey) {
      // 更新最后使用时间
      await prisma.userApiKey.update({
        where: { id: userKey.id },
        data: { lastUsed: new Date() }
      });
      
      return decrypt(userKey.encryptedKey);
    }
    
    // 3. 尝试使用系统默认 API Key
    const defaultKey = this.getSystemApiKey(provider);
    if (defaultKey) {
      return defaultKey;
    }
    
    throw Errors.apiKeyNotFound();
  }
  
  /**
   * 获取系统配置的 API Key
   */
  private getSystemApiKey(provider: LLMProvider): string | undefined {
    switch (provider) {
      case 'OPENAI':
        return config.openaiApiKey;
      case 'ANTHROPIC':
        return config.anthropicApiKey;
      case 'GOOGLE':
        return config.googleAiApiKey;
      case 'DEEPSEEK':
        return config.deepseekApiKey || process.env.DEEPSEEK_API_KEY;
      default:
        return undefined;
    }
  }
}