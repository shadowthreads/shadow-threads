# Shadow Threads

> 在任意 LLM 网页上创建影子子线程对话，深入探索而不污染主对话上下文。

## 🌟 特性

- **多平台支持**：ChatGPT、Claude、Gemini、通用适配
- **自由选择**：选中任意文本片段进行追问
- **独立上下文**：子线程有独立的对话历史，不影响主对话
- **智能路由**：自动使用当前页面对应的 LLM 进行回答
- **数据持久化**：PostgreSQL 存储，支持历史回顾

## 📁 项目结构

```
shadow-threads/
├── server/                 # 后端服务 (Node.js + Express + Prisma)
│   ├── src/
│   │   ├── api/           # API 路由层
│   │   ├── services/      # 业务逻辑层
│   │   ├── providers/     # LLM 提供商适配层
│   │   ├── middleware/    # 中间件（认证、日志、错误处理）
│   │   ├── utils/         # 工具函数
│   │   └── types/         # TypeScript 类型定义
│   ├── prisma/            # 数据库 Schema 和迁移
│   └── Dockerfile
│
├── extension/              # 浏览器扩展 (Chrome/Edge/Firefox)
│   ├── src/
│   │   ├── adapters/      # 各平台 DOM 适配器
│   │   ├── ui/            # UI 组件
│   │   └── core/          # 核心逻辑
│   └── manifest.json
│
├── docs/                   # 文档
├── docker-compose.yml      # Docker 编排
└── README.md
```

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- Docker & Docker Compose
- pnpm (推荐) 或 npm

### 1. 启动数据库

```bash
docker-compose up -d postgres redis
```

### 2. 启动后端

```bash
cd server
pnpm install
pnpm prisma:migrate
pnpm dev
```

### 3. 构建扩展

```bash
cd extension
pnpm install
pnpm build
```

### 4. 加载扩展

在浏览器中加载 `extension` 目录作为开发扩展。

## 📖 文档

- [API 文档](docs/API.md)
- [架构设计](docs/ARCHITECTURE.md)
- [开发指南](docs/DEVELOPMENT.md)
- [部署指南](docs/DEPLOYMENT.md)

## 🛠 技术栈

**后端**
- Node.js + TypeScript
- Express.js
- Prisma ORM
- PostgreSQL
- Redis

**扩展**
- TypeScript
- esbuild
- Manifest V3

**LLM 支持**
- OpenAI (GPT-4, GPT-3.5)
- Anthropic (Claude)
- Google (Gemini)
- 更多...

## 📄 License

MIT
