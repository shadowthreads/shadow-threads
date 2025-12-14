/**
 * API 客户端
 * 与后端服务器通信
 */

import { 
  ApiResponse, 
  CreateSubthreadRequest, 
  ContinueSubthreadRequest,
  SubthreadResponse,
  ExtensionSettings,
  DEFAULT_SETTINGS
} from '../types';

class ApiClient {
  private serverUrl: string;
  private deviceId: string;
  
  constructor() {
    this.serverUrl = DEFAULT_SETTINGS.serverUrl;
    this.deviceId = '';
    this.init();
  }
  
  /**
   * 初始化
   */
  private async init() {
    await this.loadSettings();
  }
  
  /**
   * 加载设置
   */
  private async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['serverUrl', 'deviceId']);
      
      if (result.serverUrl) {
        this.serverUrl = result.serverUrl;
      }
      
      if (result.deviceId) {
        this.deviceId = result.deviceId;
      } else {
        // 生成新的设备 ID
        this.deviceId = this.generateDeviceId();
        await chrome.storage.local.set({ deviceId: this.deviceId });
      }
    } catch (error) {
      console.error('[ApiClient] Failed to load settings:', error);
      this.deviceId = this.generateDeviceId();
    }
  }
  
  /**
   * 生成设备 ID
   */
  private generateDeviceId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `st_${timestamp}_${random}`;
  }
  
  /**
   * 更新服务器 URL
   */
  setServerUrl(url: string) {
    this.serverUrl = url;
    chrome.storage.local.set({ serverUrl: url });
  }
  
  /**
   * 获取请求头
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Device-ID': this.deviceId
    };
  }
  
  /**
   * 发送请求
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.serverUrl}/api/v1${endpoint}`;
    
    try {
      const response = await fetch(url, {
        method,
        headers: this.getHeaders(),
        body: body ? JSON.stringify(body) : undefined
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || {
            code: 'NETWORK_ERROR',
            message: `HTTP ${response.status}: ${response.statusText}`
          }
        };
      }
      
      return data as ApiResponse<T>;
    } catch (error) {
      console.error('[ApiClient] Request failed:', error);
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error'
        }
      };
    }
  }
  
  // ============================================
  // API 方法
  // ============================================
  
  /**
   * 健康检查
   */
  async health(): Promise<ApiResponse<{ status: string }>> {
    return this.request('GET', '/health');
  }
  
  /**
   * 创建子线程
   */
  async createSubthread(data: CreateSubthreadRequest): Promise<ApiResponse<SubthreadResponse>> {
    return this.request('POST', '/subthreads', data);
  }
  
  /**
   * 继续子线程对话
   */
  async continueSubthread(
    subthreadId: string, 
    data: ContinueSubthreadRequest
  ): Promise<ApiResponse<SubthreadResponse>> {
    return this.request('POST', `/subthreads/${subthreadId}/messages`, data);
  }
  
  /**
   * 获取子线程详情
   */
  async getSubthread(subthreadId: string): Promise<ApiResponse<any>> {
    return this.request('GET', `/subthreads/${subthreadId}`);
  }
  
  /**
   * 获取子线程列表
   */
  async listSubthreads(params?: { 
    page?: number; 
    pageSize?: number; 
    platform?: string 
  }): Promise<ApiResponse<any>> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', params.page.toString());
    if (params?.pageSize) query.set('pageSize', params.pageSize.toString());
    if (params?.platform) query.set('platform', params.platform);
    
    const endpoint = `/subthreads${query.toString() ? '?' + query.toString() : ''}`;
    return this.request('GET', endpoint);
  }
  
  /**
   * 保存 API Key
   */
  async saveApiKey(provider: string, apiKey: string): Promise<ApiResponse<any>> {
    return this.request('POST', '/users/me/api-keys', {
      provider,
      apiKey,
      isDefault: true
    });
  }
  
  /**
   * 获取用户信息
   */
  async getUserProfile(): Promise<ApiResponse<any>> {
    return this.request('GET', '/users/me');
  }
}

// 单例
export const apiClient = new ApiClient();
