# Shadow Threads Server Dockerfile

FROM node:20-alpine AS builder

WORKDIR /app

# 复制 package 文件
COPY package*.json ./
COPY prisma ./prisma/

# 安装依赖
RUN npm ci

# 复制源码
COPY . .

# 生成 Prisma Client
RUN npx prisma generate

# 构建
RUN npm run build

# ============================================
# 生产镜像
# ============================================

FROM node:20-alpine AS runner

WORKDIR /app

# 只复制生产依赖
COPY package*.json ./
RUN npm ci --only=production

# 复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# 启动
CMD ["node", "dist/index.js"]
