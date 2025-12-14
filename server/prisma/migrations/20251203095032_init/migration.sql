-- CreateEnum
CREATE TYPE "LLMProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'GOOGLE', 'GROQ', 'OLLAMA', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SubthreadStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultProvider" "LLMProvider" NOT NULL DEFAULT 'OPENAI',
    "theme" TEXT NOT NULL DEFAULT 'auto',
    "language" TEXT NOT NULL DEFAULT 'zh-CN',
    "autoSummarize" BOOLEAN NOT NULL DEFAULT true,
    "saveHistory" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "LLMProvider" NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "label" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "lastUsed" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceContext" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "conversationUrl" TEXT,
    "messageId" TEXT NOT NULL,
    "messageRole" TEXT NOT NULL,
    "messageText" TEXT NOT NULL,
    "selectionText" TEXT NOT NULL,
    "selectionStart" INTEGER,
    "selectionEnd" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subthread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceContextId" TEXT NOT NULL,
    "provider" "LLMProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "title" TEXT,
    "status" "SubthreadStatus" NOT NULL DEFAULT 'ACTIVE',
    "summary" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subthread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubthreadMessage" (
    "id" TEXT NOT NULL,
    "subthreadId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "model" TEXT,
    "finishReason" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubthreadMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_deviceId_key" ON "User"("deviceId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_deviceId_idx" ON "User"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "UserApiKey_userId_provider_idx" ON "UserApiKey"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "UserApiKey_userId_provider_label_key" ON "UserApiKey"("userId", "provider", "label");

-- CreateIndex
CREATE INDEX "SourceContext_platform_conversationId_idx" ON "SourceContext"("platform", "conversationId");

-- CreateIndex
CREATE INDEX "SourceContext_platform_messageId_idx" ON "SourceContext"("platform", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Subthread_sourceContextId_key" ON "Subthread"("sourceContextId");

-- CreateIndex
CREATE INDEX "Subthread_userId_createdAt_idx" ON "Subthread"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Subthread_userId_status_idx" ON "Subthread"("userId", "status");

-- CreateIndex
CREATE INDEX "SubthreadMessage_subthreadId_createdAt_idx" ON "SubthreadMessage"("subthreadId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserApiKey" ADD CONSTRAINT "UserApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subthread" ADD CONSTRAINT "Subthread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subthread" ADD CONSTRAINT "Subthread_sourceContextId_fkey" FOREIGN KEY ("sourceContextId") REFERENCES "SourceContext"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubthreadMessage" ADD CONSTRAINT "SubthreadMessage_subthreadId_fkey" FOREIGN KEY ("subthreadId") REFERENCES "Subthread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
