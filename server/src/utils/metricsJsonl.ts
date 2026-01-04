import fs from 'fs';
import path from 'path';
import config from './config';
import { logger } from './logger';

export type LLMMetricRecord = {
  ts: string; // ISO time
  route: string; // subthread_create | subthread_continue | state_continue | ...
  requestId?: string;

  providerRequested?: string;
  modelRequested?: string;

  providerExecuted: string;
  modelExecuted?: string;

  latencyMs: number;

  success: boolean;
  errorClass?: 'timeout' | 'rate_limit' | 'auth' | 'bad_request' | 'server' | 'network' | 'unknown';
  errorMessage?: string;

  usedFallback: boolean;
  fallbackFromProvider?: string;

  promptTokens?: number;
  completionTokens?: number;

  finishReason?: string;
};

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// 默认写到 server/logs/llm-metrics.jsonl
function getMetricsPath() {
  // 如果你希望更灵活，可从 env 读：process.env.LLM_METRICS_PATH
  const baseDir = path.resolve(process.cwd(), 'logs');
  ensureDir(baseDir);
  return path.join(baseDir, 'llm-metrics.jsonl');
}

export function appendLLMMetric(record: LLMMetricRecord) {
  // 开关：不开就直接返回（不影响主链路）
  const enabled = (process.env.CLRC_METRICS || 'on').toLowerCase() !== 'off';
  if (!enabled) return;

  try {
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(getMetricsPath(), line, { encoding: 'utf8' });
  } catch (err: any) {
    // 绝不阻塞业务
    logger.warn('Failed to append LLM metric', { error: String(err?.message || err) });
  }
}