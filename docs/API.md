# Shadow Threads API 文档

## 基本信息

- **Base URL**: `http://localhost:3001/api/v1`
- **认证方式**: 
  - JWT Token: `Authorization: Bearer <token>`
  - 设备 ID: `X-Device-ID: <device-id>`（自动注册匿名用户）

## 响应格式

所有 API 响应遵循统一格式：

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 100
  }
}
```

错误响应：

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述",
    "details": { ... }
  }
}
```

---

## 系统 API

### 健康检查

```http
GET /health
```

响应：
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "0.1.0",
  "environment": "development",
  "services": {
    "database": "healthy",
    "redis": "healthy"
  }
}
```

### 获取支持的 LLM 提供商

```http
GET /providers
```

响应：
```json
{
  "providers": [
    {
      "id": "OPENAI",
      "name": "OpenAI",
      "models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
      "defaultModel": "gpt-4o",
      "platforms": ["chatgpt"]
    },
    ...
  ]
}
```

---

## 子线程 API

### 创建子线程

```http
POST /subthreads
Content-Type: application/json
X-Device-ID: <device-id>

{
  "platform": "chatgpt",
  "conversationId": "/c/abc123",
  "conversationUrl": "https://chatgpt.com/c/abc123",
  "messageId": "msg_001",
  "messageRole": "assistant",
  "messageText": "完整的消息文本...",
  "selectionText": "用户选中的部分文本",
  "selectionStart": 100,
  "selectionEnd": 150,
  "userQuestion": "这部分是什么意思？",
  "provider": "OPENAI",
  "model": "gpt-4o"
}
```

响应：
```json
{
  "success": true,
  "data": {
    "subthread": {
      "id": "uuid",
      "provider": "OPENAI",
      "model": "gpt-4o",
      "sourceContext": {
        "platform": "chatgpt",
        "selectionText": "用户选中的部分..."
      }
    },
    "messages": [
      {
        "id": "uuid",
        "role": "USER",
        "content": "这部分是什么意思？",
        "createdAt": "2024-01-01T00:00:00.000Z"
      },
      {
        "id": "uuid",
        "role": "ASSISTANT",
        "content": "这部分内容是指...",
        "createdAt": "2024-01-01T00:00:01.000Z"
      }
    ],
    "assistantReply": {
      "id": "uuid",
      "content": "这部分内容是指..."
    }
  }
}
```

### 获取子线程列表

```http
GET /subthreads?page=1&pageSize=20&platform=chatgpt&status=ACTIVE
X-Device-ID: <device-id>
```

查询参数：
- `page`: 页码（默认 1）
- `pageSize`: 每页数量（默认 20，最大 100）
- `platform`: 过滤平台（可选）
- `status`: 状态过滤 `ACTIVE` | `ARCHIVED` | `DELETED`
- `search`: 搜索关键词（可选）

### 获取子线程详情

```http
GET /subthreads/:id
X-Device-ID: <device-id>
```

### 继续子线程对话

```http
POST /subthreads/:id/messages
Content-Type: application/json
X-Device-ID: <device-id>

{
  "userQuestion": "能详细解释一下吗？",
  "provider": "OPENAI",
  "model": "gpt-4o"
}
```

### 归档子线程

```http
POST /subthreads/:id/archive
X-Device-ID: <device-id>
```

### 删除子线程

```http
DELETE /subthreads/:id
X-Device-ID: <device-id>
```

---

## 用户 API

### 获取当前用户信息

```http
GET /users/me
X-Device-ID: <device-id>
```

响应：
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": null,
    "name": null,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "settings": {
      "defaultProvider": "OPENAI",
      "theme": "auto",
      "language": "zh-CN",
      "autoSummarize": true,
      "saveHistory": true
    },
    "apiKeys": [
      {
        "id": "uuid",
        "provider": "OPENAI",
        "label": "default",
        "isDefault": true,
        "isValid": true,
        "lastUsed": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

### 更新用户设置

```http
PATCH /users/me/settings
Content-Type: application/json
X-Device-ID: <device-id>

{
  "defaultProvider": "ANTHROPIC",
  "theme": "dark",
  "language": "en-US"
}
```

### 保存 API Key

```http
POST /users/me/api-keys
Content-Type: application/json
X-Device-ID: <device-id>

{
  "provider": "OPENAI",
  "apiKey": "sk-...",
  "label": "personal",
  "isDefault": true
}
```

### 获取 API Key 列表

```http
GET /users/me/api-keys
X-Device-ID: <device-id>
```

### 删除 API Key

```http
DELETE /users/me/api-keys/OPENAI
X-Device-ID: <device-id>
```

### 验证 API Key

```http
POST /users/me/api-keys/OPENAI/validate
X-Device-ID: <device-id>
```

响应：
```json
{
  "success": true,
  "data": {
    "valid": true
  }
}
```

---

## 错误码

| 错误码 | HTTP 状态码 | 描述 |
|--------|-------------|------|
| INTERNAL_ERROR | 500 | 服务器内部错误 |
| VALIDATION_ERROR | 400 | 请求参数验证失败 |
| NOT_FOUND | 404 | 资源不存在 |
| UNAUTHORIZED | 401 | 未认证 |
| INVALID_TOKEN | 401 | Token 无效或过期 |
| LLM_API_ERROR | 502 | LLM API 调用失败 |
| LLM_RATE_LIMIT | 429 | LLM API 速率限制 |
| LLM_INVALID_KEY | 401 | LLM API Key 无效 |
| SUBTHREAD_NOT_FOUND | 404 | 子线程不存在 |
| API_KEY_NOT_FOUND | 404 | API Key 不存在 |

---

## 平台映射

| 平台 | URL 模式 | 默认 Provider | 默认 Model |
|------|----------|---------------|------------|
| chatgpt | chatgpt.com, chat.openai.com | OPENAI | gpt-4o |
| claude | claude.ai | ANTHROPIC | claude-3-5-sonnet |
| gemini | gemini.google.com | GOOGLE | gemini-pro |
