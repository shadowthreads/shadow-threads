/**
 * ChatGPT DOM 适配器
 * 
 * 用于解析 ChatGPT 页面的 DOM 结构，获取对话消息
 * 
 * 注意：ChatGPT 的 DOM 结构可能会随时更新，如果选择器失效，需要重新检查 DOM
 * 
 * 当前支持的选择器策略（2024年12月）：
 * 1. 主要使用 data-message-author-role 属性来区分用户和助手消息
 * 2. 消息容器通常有 data-message-id 属性
 * 3. 文章元素通常包含在 article 标签中
 */

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system" | "other";
  text: string;
  element: HTMLElement;
}

/**
 * 生成唯一 ID
 */
function generateId(index: number, role: string, text: string): string {
  const hash = text.slice(0, 50).split('').reduce((acc, char) => {
    return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
  }, 0);
  return `msg_${index}_${role}_${Math.abs(hash).toString(36)}`;
}

/**
 * 获取页面上的所有对话消息
 * 
 * 策略说明：
 * - 优先使用 data-message-author-role 属性
 * - 备用策略：检查容器的 class 和结构特征
 */
export function getMessages(doc: Document = document): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  
  console.log("[ChatGPT Adapter] Scanning for messages...");
  
  // 策略 1: 使用 data-message-author-role 属性（最可靠）
  const messageContainers = doc.querySelectorAll('[data-message-author-role]');
  
  if (messageContainers.length > 0) {
    console.log(`[ChatGPT Adapter] Found ${messageContainers.length} messages using data-message-author-role`);
    
    messageContainers.forEach((container, index) => {
      const element = container as HTMLElement;
      const roleAttr = element.getAttribute('data-message-author-role');
      
      let role: ConversationMessage["role"] = "other";
      if (roleAttr === "user") {
        role = "user";
      } else if (roleAttr === "assistant") {
        role = "assistant";
      } else if (roleAttr === "system") {
        role = "system";
      }
      
      // 获取消息文本
      // ChatGPT 的消息内容通常在 .markdown 或 .prose 类的元素中
      const markdownEl = element.querySelector('.markdown, .prose, [class*="markdown"]');
      const text = (markdownEl?.textContent || element.textContent || "").trim();
      
      // 获取消息 ID（如果有的话）
      const messageId = element.getAttribute('data-message-id') || 
                       element.closest('[data-message-id]')?.getAttribute('data-message-id') ||
                       generateId(index, role, text);
      
      if (text.length > 0) {
        messages.push({
          id: messageId,
          role,
          text,
          element
        });
      }
    });
    
    return messages;
  }
  
  // 策略 2: 使用 article 标签和结构特征
  console.log("[ChatGPT Adapter] Fallback: scanning article elements...");
  const articles = doc.querySelectorAll('article, [data-testid*="conversation-turn"]');
  
  articles.forEach((article, index) => {
    const element = article as HTMLElement;
    
    // 尝试判断角色
    let role: ConversationMessage["role"] = "other";
    
    // 检查是否有 GPT 图标（表示助手消息）
    const hasGptIcon = element.querySelector('[class*="gpt"], [class*="avatar"], svg');
    const textContent = element.textContent || "";
    
    // 通过位置判断：通常奇数位是用户，偶数位是助手
    if (index % 2 === 0) {
      role = "user";
    } else {
      role = "assistant";
    }
    
    const text = textContent.trim();
    const messageId = generateId(index, role, text);
    
    if (text.length > 0) {
      messages.push({
        id: messageId,
        role,
        text,
        element
      });
    }
  });
  
  // 策略 3: 最后的备用 - 查找所有可能的消息容器
  if (messages.length === 0) {
    console.log("[ChatGPT Adapter] Fallback: scanning generic containers...");
    
    // ChatGPT 新版 UI 可能使用的选择器
    const possibleSelectors = [
      '[class*="ConversationItem"]',
      '[class*="message"]',
      '[class*="chat-message"]',
      '.group\\/conversation-turn',
      '[class*="agent-turn"]'
    ];
    
    for (const selector of possibleSelectors) {
      const elements = doc.querySelectorAll(selector);
      if (elements.length > 0) {
        console.log(`[ChatGPT Adapter] Found ${elements.length} elements with selector: ${selector}`);
        
        elements.forEach((el, index) => {
          const element = el as HTMLElement;
          const text = (element.textContent || "").trim();
          
          if (text.length > 0) {
            // 简单通过索引判断角色
            const role = index % 2 === 0 ? "user" : "assistant";
            const messageId = generateId(index, role, text);
            
            messages.push({
              id: messageId,
              role: role as ConversationMessage["role"],
              text,
              element
            });
          }
        });
        
        if (messages.length > 0) break;
      }
    }
  }
  
  console.log(`[ChatGPT Adapter] Total messages found: ${messages.length}`);
  return messages;
}

/**
 * 获取所有助手消息
 */
export function getAssistantMessages(doc: Document = document): ConversationMessage[] {
  return getMessages(doc).filter(msg => msg.role === "assistant");
}

/**
 * 检查元素是否已经有影子按钮
 */
export function hasShadowButton(element: HTMLElement): boolean {
  return element.querySelector('.shadow-threads-btn') !== null ||
         element.closest('[data-shadow-threads-processed]') !== null;
}

/**
 * 标记元素已处理
 */
export function markAsProcessed(element: HTMLElement): void {
  element.setAttribute('data-shadow-threads-processed', 'true');
}
