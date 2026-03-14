import { existsSync } from 'fs';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import path from 'path';
import { spawn } from 'child_process';
import type { ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import { URL } from 'url';

const FIXED_PACKAGE_ID = 'smoke-local-package';
const FIXED_PROMPT_HASH = '1111111111111111111111111111111111111111111111111111111111111111';
const FIXED_STARTED_AT = '2026-03-06T00:00:00.000Z';
const FIXED_FINISHED_AT = '2026-03-06T00:00:01.000Z';
const FIXED_DEVICE_ID = 'smoke-local-device';
const READY_TIMEOUT_MS = 30000;
const HTTP_TIMEOUT_MS = 10000;
const HASH64_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ARTIFACT_REQUEST = {
  schema: 'artifact.task.state.v1',
  identity: {
    packageId: FIXED_PACKAGE_ID,
    revisionId: null,
    revisionHash: null,
  },
  payload: {
    name: 'smoke-state',
    step: 1,
  },
  references: [],
} as const;

const REVISION_METADATA = {
  author: 'smoke-test',
  message: 'initial revision',
  createdBy: 'smoke-test',
  timestamp: FIXED_STARTED_AT,
  source: 'system',
  tags: ['smoke', 'local-api'],
} as const;

type StepRecord = {
  step: string;
  request: unknown;
  statusCode: number | null;
  response: unknown;
};

type ServiceProcess = {
  child: ChildProcessByStdio<null, Readable, Readable>;
  stdoutText: string;
  stderrText: string;
  baseUrl: string | null;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
};

type HttpResult = {
  statusCode: number;
  bodyText: string;
  bodyJson: unknown;
};

type FailureContext = {
  step: string;
  request: unknown;
  statusCode: number | null;
  response: unknown;
  reason: string;
};

function appendLog(current: string, chunk: Buffer): string {
  const next = current + chunk.toString('utf8');
  return next.length > 20000 ? next.slice(next.length - 20000) : next;
}

function extractBaseUrl(text: string): string | null {
  const match = text.match(/Listening:\s+(http:\/\/(?:localhost|127\.0\.0\.1):\d+)/i);
  return match ? match[1] : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getServerRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

function getStartCommand(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm run start'],
    };
  }

  return {
    command: 'npm',
    args: ['run', 'start'],
  };
}

function toObject(value: unknown, step: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${step}:invalid_json_object`);
  }
  return value as Record<string, unknown>;
}

function assertHash64(value: unknown, step: string, field: string): string {
  if (typeof value !== 'string' || !HASH64_PATTERN.test(value)) {
    throw new Error(`${step}:${field}`);
  }
  return value;
}

function assertUuid(value: unknown, step: string, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`${step}:${field}`);
  }
  return value;
}

function assertString(value: unknown, step: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${step}:${field}`);
  }
  return value;
}

function assertNumber(value: unknown, step: string, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${step}:${field}`);
  }
  return value;
}

function assertSuccessEnvelope(result: HttpResult, step: string): Record<string, unknown> {
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`${step}:http_status`);
  }
  const json = toObject(result.bodyJson, step);
  if (json.ok !== true) {
    throw new Error(`${step}:ok_flag`);
  }
  const data = json.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${step}:data`);
  }
  return data as Record<string, unknown>;
}

function safeJsonParse(bodyText: string): unknown {
  if (!bodyText) {
    return null;
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

function sendHttpJson(method: 'GET' | 'POST', url: string, body?: unknown): Promise<HttpResult> {
  const parsedUrl = new URL(url);
  const payload = typeof body === 'undefined' ? null : JSON.stringify(body);
  const transport = parsedUrl.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = transport(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': FIXED_DEVICE_ID,
          ...(payload === null ? {} : { 'Content-Length': Buffer.byteLength(payload) }),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const bodyText = Buffer.concat(chunks).toString('utf8');
          resolve({
            statusCode: res.statusCode ?? 0,
            bodyText,
            bodyJson: safeJsonParse(bodyText),
          });
        });
      }
    );

    req.setTimeout(HTTP_TIMEOUT_MS, () => {
      req.destroy(new Error('http_timeout'));
    });
    req.on('error', reject);

    if (payload !== null) {
      req.write(payload);
    }
    req.end();
  });
}

function startServiceProcess(): ServiceProcess {
  const startCommand = getStartCommand();
  const child = spawn(startCommand.command, startCommand.args, {
    cwd: getServerRoot(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  const state: ServiceProcess = {
    child,
    stdoutText: '',
    stderrText: '',
    baseUrl: null,
    exitCode: null,
    exitSignal: null,
  };

  child.stdout.on('data', (chunk: Buffer) => {
    state.stdoutText = appendLog(state.stdoutText, chunk);
    const nextBaseUrl = extractBaseUrl(state.stdoutText);
    if (nextBaseUrl) {
      state.baseUrl = nextBaseUrl;
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    state.stderrText = appendLog(state.stderrText, chunk);
    const nextBaseUrl = extractBaseUrl(state.stderrText);
    if (nextBaseUrl) {
      state.baseUrl = nextBaseUrl;
    }
  });

  child.on('exit', (code, signal) => {
    state.exitCode = code;
    state.exitSignal = signal;
  });

  return state;
}

async function waitForServiceReady(state: ServiceProcess): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    if (state.exitCode !== null) {
      throw new Error('service_exited_before_ready');
    }

    if (state.baseUrl) {
      try {
        await sendHttpJson('GET', `${state.baseUrl}/api/v1/revisions/package/__healthcheck__?limit=1`);
        return state.baseUrl;
      } catch {
        // keep polling until the listener is ready
      }
    }

    await delay(250);
  }

  throw new Error('service_ready_timeout');
}

function createFailure(step: string, request: unknown, statusCode: number | null, response: unknown, reason: string): FailureContext {
  return {
    step,
    request,
    statusCode,
    response,
    reason,
  };
}

async function stopServiceProcess(state: ServiceProcess): Promise<boolean> {
  if (state.exitCode !== null) {
    return true;
  }

  if (typeof state.child.pid !== 'number') {
    return false;
  }

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(state.child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      killer.on('exit', () => resolve());
      killer.on('error', () => resolve());
    });
  } else {
    state.child.kill('SIGTERM');
  }

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (state.exitCode !== null) {
      return true;
    }
    await delay(100);
  }

  return state.exitCode !== null;
}

async function main(): Promise<void> {
  const steps: StepRecord[] = [];
  const service = startServiceProcess();
  let failure: FailureContext | null = null;
  let serviceStopped = false;

  try {
    const baseUrl = await waitForServiceReady(service);

    const artifactResult = await sendHttpJson('POST', `${baseUrl}/api/v1/artifacts`, ARTIFACT_REQUEST);
    steps.push({
      step: 'artifact',
      request: ARTIFACT_REQUEST,
      statusCode: artifactResult.statusCode,
      response: artifactResult.bodyJson,
    });
    const artifactData = assertSuccessEnvelope(artifactResult, 'artifact');
    const bundleHash = assertHash64(artifactData.bundleHash, 'artifact', 'bundleHash');
    assertString(artifactData.id, 'artifact', 'id');
    assertString(artifactData.createdAt, 'artifact', 'createdAt');

    const revisionRequest = {
      packageId: FIXED_PACKAGE_ID,
      parentRevisionHash: null,
      artifacts: [
        {
          bundleHash,
          role: 'primary_state',
        },
      ],
      metadata: REVISION_METADATA,
    };
    const revisionResult = await sendHttpJson('POST', `${baseUrl}/api/v1/revisions`, revisionRequest);
    steps.push({
      step: 'revision',
      request: revisionRequest,
      statusCode: revisionResult.statusCode,
      response: revisionResult.bodyJson,
    });
    const revisionData = assertSuccessEnvelope(revisionResult, 'revision');
    const revisionHash = assertHash64(revisionData.revisionHash, 'revision', 'revisionHash');

    const executionRequest = {
      packageId: FIXED_PACKAGE_ID,
      revisionHash,
      provider: 'local-smoke',
      model: 'shadow-smoke-model',
      promptHash: FIXED_PROMPT_HASH,
      parameters: {
        temperature: 0,
      },
      inputArtifacts: [
        {
          bundleHash,
          role: 'primary_state',
        },
      ],
      outputArtifacts: [
        {
          bundleHash,
          role: 'result',
        },
      ],
      status: 'success',
      startedAt: FIXED_STARTED_AT,
      finishedAt: FIXED_FINISHED_AT,
    };
    const executionResult = await sendHttpJson('POST', `${baseUrl}/api/v1/executions`, executionRequest);
    steps.push({
      step: 'execution',
      request: executionRequest,
      statusCode: executionResult.statusCode,
      response: executionResult.bodyJson,
    });
    const executionData = assertSuccessEnvelope(executionResult, 'execution');
    const executionId = assertUuid(executionData.executionId, 'execution', 'executionId');
    const resultHash = assertHash64(executionData.resultHash, 'execution', 'resultHash');

    const migrationRequest = {
      rootRevisionHash: revisionHash,
    };
    const migrationResult = await sendHttpJson('POST', `${baseUrl}/api/v1/migration/export`, migrationRequest);
    steps.push({
      step: 'migration_export',
      request: migrationRequest,
      statusCode: migrationResult.statusCode,
      response: migrationResult.bodyJson,
    });
    const migrationData = assertSuccessEnvelope(migrationResult, 'migration_export');
    const zipPath = assertString(migrationData.zipPath, 'migration_export', 'zipPath');
    const manifest = toObject(migrationData.manifest, 'migration_export');
    assertHash64(manifest.rootRevisionHash, 'migration_export', 'manifest.rootRevisionHash');
    assertNumber(manifest.artifactCount, 'migration_export', 'manifest.artifactCount');
    assertNumber(manifest.revisionCount, 'migration_export', 'manifest.revisionCount');
    if (manifest.rootRevisionHash !== revisionHash) {
      throw new Error('migration_export:manifest.rootRevisionHash');
    }
    if (!existsSync(zipPath)) {
      throw new Error('migration_export:zipPathMissing');
    }

    serviceStopped = await stopServiceProcess(service);

    const summary = {
      baseUrl,
      bundleHash,
      revisionHash,
      executionId,
      resultHash,
      zipPath,
      serviceStopped,
      steps,
    };

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write('HTTP_API_E2E_OK\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_failure';
    const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
    failure = createFailure(
      lastStep ? lastStep.step : 'service_start',
      lastStep ? lastStep.request : null,
      lastStep ? lastStep.statusCode : null,
      lastStep ? lastStep.response : null,
      message
    );
  } finally {
    if (!serviceStopped) {
      serviceStopped = await stopServiceProcess(service);
    }

    if (failure) {
      const failureReport = {
        failure,
        serviceStopped,
        baseUrl: service.baseUrl,
        stdoutTail: service.stdoutText,
        stderrTail: service.stderrText,
        steps,
      };
      process.stdout.write(`${JSON.stringify(failureReport, null, 2)}\n`);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : 'unknown_failure';
    process.stdout.write(`${JSON.stringify({ failure: { step: 'bootstrap', reason: message } }, null, 2)}\n`);
    process.exit(1);
  });
}
