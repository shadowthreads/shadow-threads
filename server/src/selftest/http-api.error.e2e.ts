import path from 'path';
import { spawn } from 'child_process';
import type { ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';

const PACKAGE_ID = 'g3-error-test-package';
const DEVICE_ID = 'g3-error-test-device';
const READY_TIMEOUT_MS = 30000;
const HTTP_TIMEOUT_MS = 10000;
const HASH64_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HAPPY_PROMPT_HASH = '1111111111111111111111111111111111111111111111111111111111111111';
const MISMATCH_PROMPT_HASH = '2222222222222222222222222222222222222222222222222222222222222222';
const STARTED_AT = '2026-03-06T00:00:00.000Z';
const FINISHED_AT = '2026-03-06T00:00:01.000Z';
const MISSING_PARENT_HASH = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const NOT_FOUND_BUNDLE_HASH = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

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

type CaseSummary = {
  caseName: string;
  status: number;
  errorCode: string;
  pass: boolean;
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

function safeJsonParse(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toObject(value: unknown, step: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${step}:invalid_object`);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, step: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${step}:${field}`);
  }
  return value;
}

function assertHash64(value: unknown, step: string, field: string): string {
  const out = assertString(value, step, field);
  if (!HASH64_PATTERN.test(out)) {
    throw new Error(`${step}:${field}`);
  }
  return out;
}

function assertUuid(value: unknown, step: string, field: string): string {
  const out = assertString(value, step, field);
  if (!UUID_PATTERN.test(out)) {
    throw new Error(`${step}:${field}`);
  }
  return out;
}

async function sendJsonRequest(method: 'GET' | 'POST', url: string, body?: unknown): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': DEVICE_ID,
      },
      ...(typeof body === 'undefined' ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    return {
      statusCode: response.status,
      bodyText,
      bodyJson: safeJsonParse(bodyText),
    };
  } finally {
    clearTimeout(timer);
  }
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
        const response = await sendJsonRequest('GET', `${state.baseUrl}/api/v1/revisions/package/__healthcheck__?limit=1`);
        if (response.statusCode > 0) {
          return state.baseUrl;
        }
      } catch {
        // continue polling
      }
    }

    await delay(250);
  }

  throw new Error('service_ready_timeout');
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

function assertSuccessEnvelope(result: HttpResult, step: string): Record<string, unknown> {
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`${step}:http_status`);
  }
  const body = toObject(result.bodyJson, step);
  if (body.ok !== true) {
    throw new Error(`${step}:ok_flag`);
  }
  const data = body.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${step}:data`);
  }
  return data as Record<string, unknown>;
}

function validateErrorCase(
  caseName: string,
  result: HttpResult,
  allowedStatuses: number[],
  allowedCodes?: string[]
): CaseSummary {
  const body = toObject(result.bodyJson, caseName);
  if (!allowedStatuses.includes(result.statusCode)) {
    throw new Error(`${caseName}:status`);
  }
  if (body.ok !== false) {
    throw new Error(`${caseName}:ok_flag`);
  }
  const error = toObject(body.error, caseName);
  const errorCode = assertString(error.code, caseName, 'error.code');
  assertString(error.message, caseName, 'error.message');
  if (Array.isArray(allowedCodes) && allowedCodes.length > 0 && !allowedCodes.includes(errorCode)) {
    throw new Error(`${caseName}:error.code`);
  }
  return {
    caseName,
    status: result.statusCode,
    errorCode,
    pass: true,
  };
}

async function createFixtureArtifact(baseUrl: string): Promise<{ bundleHash: string }> {
  const artifactRequest = {
    schema: 'artifact.task.state.v1',
    identity: {
      packageId: PACKAGE_ID,
      revisionId: null,
      revisionHash: null,
    },
    payload: {
      name: 'g3-state',
      step: 1,
    },
    references: [],
  };
  const artifactResult = await sendJsonRequest('POST', `${baseUrl}/api/v1/artifacts`, artifactRequest);
  const artifactData = assertSuccessEnvelope(artifactResult, 'fixture_artifact');
  return {
    bundleHash: assertHash64(artifactData.bundleHash, 'fixture_artifact', 'bundleHash'),
  };
}

async function createFixtureExecution(baseUrl: string, bundleHash: string): Promise<{ revisionHash: string; executionId: string }> {
  const revisionRequest = {
    packageId: PACKAGE_ID,
    parentRevisionHash: null,
    artifacts: [
      {
        bundleHash,
        role: 'primary_state',
      },
    ],
    metadata: {
      author: 'smoke-test',
      message: 'initial revision',
      createdBy: 'smoke-test',
      timestamp: STARTED_AT,
      source: 'system',
      tags: ['smoke', 'local-api'],
    },
  };
  const revisionResult = await sendJsonRequest('POST', `${baseUrl}/api/v1/revisions`, revisionRequest);
  const revisionData = assertSuccessEnvelope(revisionResult, 'fixture_revision');
  const revisionHash = assertHash64(revisionData.revisionHash, 'fixture_revision', 'revisionHash');

  const executionRequest = {
    packageId: PACKAGE_ID,
    revisionHash,
    provider: 'local-smoke',
    model: 'shadow-smoke-model',
    promptHash: HAPPY_PROMPT_HASH,
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
    startedAt: STARTED_AT,
    finishedAt: FINISHED_AT,
  };
  const executionResult = await sendJsonRequest('POST', `${baseUrl}/api/v1/executions`, executionRequest);
  const executionData = assertSuccessEnvelope(executionResult, 'fixture_execution');

  return {
    revisionHash,
    executionId: assertUuid(executionData.executionId, 'fixture_execution', 'executionId'),
  };
}

async function main(): Promise<void> {
  const service = startServiceProcess();
  let serviceStopped = false;
  let failure: FailureContext | null = null;
  const caseSummaries: CaseSummary[] = [];
  const steps: Array<{ caseName: string; request: unknown; statusCode: number | null; response: unknown }> = [];
  let bundleHash: string | null = null;
  let revisionHash: string | null = null;
  let executionId: string | null = null;

  try {
    const baseUrl = await waitForServiceReady(service);

    const fixtureArtifact = await createFixtureArtifact(baseUrl);
    bundleHash = fixtureArtifact.bundleHash;

    const case1Request = {
      identity: {
        revisionId: null,
        revisionHash: null,
      },
      payload: {
        name: 'broken',
      },
      references: 'not-an-array',
    };
    const case1Result = await sendJsonRequest('POST', `${baseUrl}/api/v1/artifacts`, case1Request);
    steps.push({ caseName: 'artifact_invalid_input', request: case1Request, statusCode: case1Result.statusCode, response: case1Result.bodyJson });
    caseSummaries.push(validateErrorCase('artifact_invalid_input', case1Result, [400]));

    const case2Request = null;
    const case2Result = await sendJsonRequest('GET', `${baseUrl}/api/v1/artifacts/non-existent-package/${NOT_FOUND_BUNDLE_HASH}`);
    steps.push({ caseName: 'artifact_not_found', request: case2Request, statusCode: case2Result.statusCode, response: case2Result.bodyJson });
    caseSummaries.push(validateErrorCase('artifact_not_found', case2Result, [404], ['ERR_ARTIFACT_NOT_FOUND']));

    const case3Request = {
      packageId: PACKAGE_ID,
      parentRevisionHash: MISSING_PARENT_HASH,
      artifacts: [
        {
          bundleHash,
          role: 'primary_state',
        },
      ],
      metadata: {
        author: 'smoke-test',
        message: 'missing parent',
        createdBy: 'smoke-test',
        timestamp: STARTED_AT,
        source: 'system',
        tags: ['g3', 'missing-parent'],
      },
    };
    const case3Result = await sendJsonRequest('POST', `${baseUrl}/api/v1/revisions`, case3Request);
    steps.push({ caseName: 'revision_parent_missing', request: case3Request, statusCode: case3Result.statusCode, response: case3Result.bodyJson });
    caseSummaries.push(validateErrorCase('revision_parent_missing', case3Result, [404], ['ERR_REVISION_PARENT_NOT_FOUND']));

    const case4Request = {
      packageId: PACKAGE_ID,
      revisionHash: MISSING_PARENT_HASH,
      provider: 'local-smoke',
      model: 'shadow-smoke-model',
      promptHash: 'not-a-hex-hash',
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
      status: 'done',
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
    };
    const case4Result = await sendJsonRequest('POST', `${baseUrl}/api/v1/executions`, case4Request);
    steps.push({ caseName: 'execution_invalid_input', request: case4Request, statusCode: case4Result.statusCode, response: case4Result.bodyJson });
    caseSummaries.push(validateErrorCase('execution_invalid_input', case4Result, [400]));

    const fixtureExecution = await createFixtureExecution(baseUrl, bundleHash);
    revisionHash = fixtureExecution.revisionHash;
    executionId = fixtureExecution.executionId;

    const case5Request = {
      promptHash: MISMATCH_PROMPT_HASH,
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
    };
    const case5Result = await sendJsonRequest('POST', `${baseUrl}/api/v1/executions/${executionId}/replay`, case5Request);
    steps.push({ caseName: 'execution_replay_mismatch', request: case5Request, statusCode: case5Result.statusCode, response: case5Result.bodyJson });
    caseSummaries.push(
      validateErrorCase('execution_replay_mismatch', case5Result, [422], [
        'ERR_EXECUTION_NON_DETERMINISTIC',
        'ERR_EXECUTION_REPLAY_MISMATCH',
      ])
    );

    const case6Request = {
      zipPath: path.resolve(getServerRoot(), 'tmp', 'g3-error-test', 'missing.zip'),
    };
    const case6Result = await sendJsonRequest('POST', `${baseUrl}/api/v1/migration/verify`, case6Request);
    steps.push({ caseName: 'migration_verify_invalid_path', request: case6Request, statusCode: case6Result.statusCode, response: case6Result.bodyJson });
    caseSummaries.push(validateErrorCase('migration_verify_invalid_path', case6Result, [400, 404, 422]));

    serviceStopped = await stopServiceProcess(service);

    process.stdout.write(
      `${JSON.stringify(
        {
          baseUrl,
          happyPathFixture: {
            packageId: PACKAGE_ID,
            bundleHash,
            revisionHash,
            executionId,
          },
          cases: caseSummaries,
          steps,
          serviceStopped,
        },
        null,
        2
      )}\n`
    );
    process.stdout.write('HTTP_API_ERROR_E2E_OK\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_failure';
    const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
    failure = {
      step: lastStep ? lastStep.caseName : 'service_start',
      request: lastStep ? lastStep.request : null,
      statusCode: lastStep ? lastStep.statusCode : null,
      response: lastStep ? lastStep.response : null,
      reason: message,
    };
  } finally {
    if (!serviceStopped) {
      serviceStopped = await stopServiceProcess(service);
    }

    if (failure) {
      process.stdout.write(
        `${JSON.stringify(
          {
            failure,
            happyPathFixture: {
              packageId: PACKAGE_ID,
              bundleHash,
              revisionHash,
              executionId,
            },
            cases: caseSummaries,
            steps,
            serviceStopped,
            baseUrl: service.baseUrl,
            stdoutTail: service.stdoutText,
            stderrTail: service.stderrText,
          },
          null,
          2
        )}\n`
      );
      process.exit(1);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    const reason = error instanceof Error ? error.message : 'unknown_failure';
    process.stdout.write(`${JSON.stringify({ failure: { step: 'bootstrap', reason } }, null, 2)}\n`);
    process.exit(1);
  });
}
