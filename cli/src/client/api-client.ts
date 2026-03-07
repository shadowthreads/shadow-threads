import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { ZodError, z } from 'zod';
import { CliError, EXIT_CODE_CLIENT_ERROR, EXIT_CODE_NETWORK_ERROR, EXIT_CODE_SERVER_ERROR } from '../utils/errors';

const hash64Schema = z.string().regex(/^[0-9a-f]{64}$/);
const artifactReferenceSchema = z.object({
  bundleHash: hash64Schema,
  role: z.string().min(1),
});

const executionStatusSchema = z.enum(['success', 'failure']);

const apiSuccessEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: z.unknown(),
});

const apiErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});

export const artifactCreateBodySchema = z.object({
  schema: z.string().min(1),
  identity: z.object({
    packageId: z.string().min(1),
    revisionId: z.union([z.string().min(1), z.null()]).optional().default(null),
    revisionHash: z.union([hash64Schema, z.null()]).optional().default(null),
  }),
  payload: z.unknown(),
  references: z.array(artifactReferenceSchema).optional().default([]),
});

const artifactCreateResponseSchema = z.object({
  id: z.string().min(1),
  bundleHash: hash64Schema,
  createdAt: z.string().min(1),
});

const executionRecordSchema = z.object({
  executionId: z.string().uuid(),
  packageId: z.string().min(1),
  revisionHash: hash64Schema,
  provider: z.string().min(1),
  model: z.string().min(1),
  promptHash: hash64Schema,
  parameters: z.unknown(),
  inputArtifacts: z.array(artifactReferenceSchema),
  outputArtifacts: z.array(artifactReferenceSchema),
  resultHash: hash64Schema,
  status: executionStatusSchema,
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  createdAt: z.string().min(1),
});

const replayExecutionBodySchema = z.object({
  promptHash: hash64Schema,
  parameters: z.unknown(),
  inputArtifacts: z.array(artifactReferenceSchema),
  outputArtifacts: z.array(artifactReferenceSchema).optional(),
  status: executionStatusSchema.optional(),
});

const replayExecutionResponseSchema = z.object({
  executionId: z.string().uuid(),
  verified: z.boolean(),
  resultHash: hash64Schema,
});

const migrationExportResponseSchema = z.object({
  zipPath: z.string().min(1),
  manifest: z.object({
    rootRevisionHash: hash64Schema,
    artifactCount: z.number().int().nonnegative(),
    revisionCount: z.number().int().nonnegative(),
  }),
});

export type ArtifactCreateBody = z.infer<typeof artifactCreateBodySchema>;
export type ExecutionRecord = z.infer<typeof executionRecordSchema>;
export type ReplayExecutionBody = z.infer<typeof replayExecutionBodySchema>;
export type ReplayExecutionResult = z.infer<typeof replayExecutionResponseSchema>;
export type MigrationExportResult = z.infer<typeof migrationExportResponseSchema>;

export class ShadowClient {
  private readonly http: AxiosInstance;
  private readonly baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.http = axios.create({
      baseURL,
      timeout: 30_000,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  async createArtifact(payload: ArtifactCreateBody): Promise<z.infer<typeof artifactCreateResponseSchema>> {
    const body = artifactCreateBodySchema.parse(payload);
    return this.request(
      {
        method: 'POST',
        url: '/api/v1/artifacts',
        data: body,
      },
      artifactCreateResponseSchema,
    );
  }

  async getRevision(id: string): Promise<unknown> {
    return this.request(
      {
        method: 'GET',
        url: `/api/v1/revisions/${encodeURIComponent(id)}`,
      },
      z.unknown(),
    );
  }

  async getArtifact(hash: string, packageId: string): Promise<unknown> {
    return this.request(
      {
        method: 'GET',
        url: `/api/v1/artifacts/${encodeURIComponent(packageId)}/${encodeURIComponent(hash)}`,
      },
      z.unknown(),
    );
  }

  async getExecution(id: string): Promise<ExecutionRecord> {
    return this.request(
      {
        method: 'GET',
        url: `/api/v1/executions/${encodeURIComponent(id)}`,
      },
      executionRecordSchema,
    );
  }

  async replayExecution(id: string, payload: ReplayExecutionBody): Promise<ReplayExecutionResult> {
    const body = replayExecutionBodySchema.parse(payload);
    return this.request(
      {
        method: 'POST',
        url: `/api/v1/executions/${encodeURIComponent(id)}/replay`,
        data: body,
      },
      replayExecutionResponseSchema,
    );
  }

  async exportMigration(revisionId: string): Promise<MigrationExportResult> {
    return this.request(
      {
        method: 'POST',
        url: '/api/v1/migration/export',
        data: { rootRevisionHash: revisionId },
      },
      migrationExportResponseSchema,
    );
  }

  private async request<T>(config: AxiosRequestConfig, schema: z.ZodType<T>): Promise<T> {
    try {
      const response = await this.http.request(config);
      const envelope = apiSuccessEnvelopeSchema.parse(response.data);
      return schema.parse(envelope.data);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof CliError) {
      return error;
    }

    if (error instanceof ZodError) {
      return new CliError(`Invalid server response from ${this.baseURL}: ${error.message}`, EXIT_CODE_SERVER_ERROR);
    }

    if (axios.isAxiosError(error)) {
      return this.normalizeAxiosError(error);
    }

    if (error instanceof Error) {
      return error;
    }

    return new CliError('Unknown client error');
  }

  private normalizeAxiosError(error: AxiosError): CliError {
    if (error.response) {
      const parsed = apiErrorEnvelopeSchema.safeParse(error.response.data);
      const exitCode = error.response.status >= 500 ? EXIT_CODE_SERVER_ERROR : EXIT_CODE_CLIENT_ERROR;

      if (parsed.success) {
        return new CliError(parsed.data.error.message, exitCode);
      }

      if (error.response.status >= 500) {
        return new CliError(`Server request failed with HTTP ${error.response.status}`, EXIT_CODE_SERVER_ERROR);
      }

      return new CliError(`Request failed with HTTP ${error.response.status}`, EXIT_CODE_CLIENT_ERROR);
    }

    if (error.request) {
      return new CliError(`Unable to reach server at ${this.baseURL}`, EXIT_CODE_NETWORK_ERROR);
    }

    return new CliError(error.message, EXIT_CODE_NETWORK_ERROR);
  }
}
