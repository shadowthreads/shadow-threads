# Shadow Threads 快速启动指南

## 前置要求

- Node.js >= 18
- Docker & Docker Compose
- pnpm 或 npm

---

## 第一步：启动数据库

```bash
# 在项目根目录
docker-compose up -d postgres redis
```

等待几秒钟，确认容器运行：

```bash
docker-compose ps
```

应该看到 `shadow-threads-db` 和 `shadow-threads-redis` 状态为 `running`。

---

## 第二步：配置环境变量

```bash
cd server

# 复制环境变量模板
cp .env.example .env

# 编辑 .env，添加你的 API Key（可选）
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
```

---

## 第三步：安装依赖并初始化数据库

```bash
cd server

# 安装依赖
npm install

# 生成 Prisma Client
npx prisma generate

# 运行数据库迁移
npx prisma migrate dev --name init
```

---

## 第四步：启动后端服务

```bash
npm run dev
```

看到以下输出表示启动成功：

```
==================================================
🚀 Shadow Threads Server v0.1.0
   Environment: development
   API Prefix:  /api/v1
   Listening:   http://localhost:3001
==================================================
```

---

## 第五步：测试 API

```bash
# 健康检查
curl http://localhost:3001/api/v1/health

# 获取支持的提供商
curl http://localhost:3001/api/v1/providers
```

---

## 使用 API（无 API Key 时测试）

如果你还没有配置 API Key，可以先测试 API 结构：

```bash
# 会返回 API_KEY_NOT_FOUND 错误，但说明 API 正常工作
curl -X POST http://localhost:3001/api/v1/subthreads \
  -H "Content-Type: application/json" \
  -H "X-Device-ID: test-device-001" \
  -d '{
    "platform": "chatgpt",
    "conversationId": "/c/test",
    "messageId": "msg_001",
    "messageText": "这是一段测试文本",
    "selectionText": "测试文本",
    "userQuestion": "这是什么意思？"
  }'
```

---

## 配置 API Key

### 方法 1：环境变量（系统级）

在 `.env` 文件中配置：

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

### 方法 2：API 保存（用户级）

```bash
curl -X POST http://localhost:3001/api/v1/users/me/api-keys \
  -H "Content-Type: application/json" \
  -H "X-Device-ID: test-device-001" \
  -d '{
    "provider": "OPENAI",
    "apiKey": "sk-your-api-key",
    "isDefault": true
  }'
```

---

## 查看数据库

```bash
cd server
npx prisma studio
```

会打开一个网页界面，可以浏览和编辑数据库内容。

---

## 停止服务

```bash
# 停止后端
Ctrl+C

# 停止数据库
docker-compose down

# 如果想清除数据
docker-compose down -v
```

---

## 下一步

1. 构建和测试扩展（见后续模块）
2. 配置更多 LLM 提供商
3. 部署到生产环境
