import express from 'express';
import type { Express, Request, Response } from 'express';
import artifactRoutes from '../routes/artifact.routes';
import revisionRoutes from '../routes/revision.routes';
import executionRoutes from '../routes/execution.routes';
import migrationRoutes from '../routes/migration.routes';
import { createArtifact } from '../controllers/artifact.controller';
import { createRevision } from '../controllers/revision.controller';
import { recordExecution } from '../controllers/execution.controller';
import { verifyMigration } from '../controllers/migration.controller';

type MockResponse = Response & {
  statusCodeValue: number;
  jsonBody: unknown;
};

function createMockResponse(): MockResponse {
  const response: {
    statusCodeValue: number;
    jsonBody: unknown;
    status(code: number): MockResponse;
    json(payload: unknown): MockResponse;
  } = {
    statusCodeValue: 200,
    jsonBody: undefined,
    status(code: number) {
      response.statusCodeValue = code;
      return response as unknown as MockResponse;
    },
    json(payload: unknown) {
      response.jsonBody = payload;
      return response as unknown as MockResponse;
    },
  };

  return response as unknown as MockResponse;
}

function assertCondition(condition: boolean): void {
  if (!condition) {
    throw new Error('http_api_selftest_failed');
  }
}

function hasMountedPath(app: Express, fragment: string): boolean {
  const stack = (app as unknown as { _router?: { stack?: Array<{ regexp?: { toString(): string } }> } })._router?.stack;
  if (!Array.isArray(stack)) {
    return false;
  }

  return stack.some((layer) => {
    if (!layer.regexp || typeof layer.regexp.toString !== 'function') {
      return false;
    }
    return layer.regexp.toString().includes(fragment);
  });
}

function assertInvalidRequestResponse(response: MockResponse): void {
  const payload = response.jsonBody as {
    ok?: unknown;
    error?: { code?: unknown; message?: unknown };
  };

  assertCondition(response.statusCodeValue === 400);
  assertCondition(Boolean(payload) && payload.ok === false);
  assertCondition(Boolean(payload.error) && payload.error?.code === 'ERR_INVALID_INPUT');
  assertCondition(typeof payload.error?.message === 'string' && payload.error.message.length > 0);
}

async function runHttpApiSelftest(): Promise<void> {
  const app = express();
  app.use('/api/v1/artifacts', artifactRoutes);
  app.use('/api/v1/revisions', revisionRoutes);
  app.use('/api/v1/executions', executionRoutes);
  app.use('/api/v1/migration', migrationRoutes);

  assertCondition(hasMountedPath(app, 'artifacts'));
  assertCondition(hasMountedPath(app, 'revisions'));
  assertCondition(hasMountedPath(app, 'executions'));
  assertCondition(hasMountedPath(app, 'migration'));

  const artifactResponse = createMockResponse();
  await createArtifact({ body: {}, params: {}, query: {} } as Request, artifactResponse);
  assertInvalidRequestResponse(artifactResponse);

  const revisionResponse = createMockResponse();
  await createRevision({ body: {}, params: {}, query: {} } as Request, revisionResponse);
  assertInvalidRequestResponse(revisionResponse);

  const executionResponse = createMockResponse();
  await recordExecution({ body: {}, params: {}, query: {} } as Request, executionResponse);
  assertInvalidRequestResponse(executionResponse);

  const migrationResponse = createMockResponse();
  await verifyMigration({ body: {}, params: {}, query: {} } as Request, migrationResponse);
  assertInvalidRequestResponse(migrationResponse);
}

if (require.main === module) {
  runHttpApiSelftest()
    .then(() => {
      process.stdout.write('HTTP_API_SELFTEST_OK\n');
    })
    .catch(() => {
      process.stdout.write('HTTP_API_SELFTEST_FAIL\n');
      process.exit(1);
    });
}

export { runHttpApiSelftest };
