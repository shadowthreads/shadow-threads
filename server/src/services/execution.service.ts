import type { PrismaClient } from '@prisma/client';
import { canonicalizeJson } from '../lib/artifact-hash';
import {
  computeExecutionResultHash,
  type ExecutionArtifactReference,
  type ExecutionStatus,
} from '../lib/execution-hash';
import { sanitizeJsonPayload } from '../lib/json-sanitize';

const EXECUTION_HASH_PATTERN = /^[0-9a-f]{64}$/;
const EXECUTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ERR_EXECUTION_INVALID_INPUT = 'ERR_EXECUTION_INVALID_INPUT';
const ERR_REVISION_NOT_FOUND = 'ERR_REVISION_NOT_FOUND';
const ERR_ARTIFACT_NOT_FOUND = 'ERR_ARTIFACT_NOT_FOUND';
const ERR_EXECUTION_NOT_FOUND = 'ERR_EXECUTION_NOT_FOUND';
const ERR_EXECUTION_NON_DETERMINISTIC = 'ERR_EXECUTION_NON_DETERMINISTIC';
const ERR_EXECUTION_REPLAY_MISMATCH = 'ERR_EXECUTION_REPLAY_MISMATCH';

const MESSAGE_EXECUTION_INVALID_INPUT = 'Execution input is invalid';
const MESSAGE_REVISION_NOT_FOUND = 'Revision not found';
const MESSAGE_ARTIFACT_NOT_FOUND = 'Artifact not found';
const MESSAGE_EXECUTION_NOT_FOUND = 'Execution record not found';
const MESSAGE_EXECUTION_NON_DETERMINISTIC = 'Execution replay is non-deterministic';
const MESSAGE_EXECUTION_REPLAY_MISMATCH = 'Execution replay result hash mismatch';

export type RecordExecutionInput = {
  executionId?: string;
  packageId: string;
  revisionHash: string;
  provider: string;
  model: string;
  promptHash: string;
  parameters: unknown;
  inputArtifacts: ExecutionArtifactReference[];
  outputArtifacts: ExecutionArtifactReference[];
  status: ExecutionStatus;
  startedAt: string;
  finishedAt: string;
};

export type GetExecutionQuery = {
  executionId: string;
};

export type ListExecutionsQuery = {
  packageId: string;
  limit?: number;
};

export type ReplayExecutionInput = {
  executionId: string;
  promptHash: string;
  parameters: unknown;
  inputArtifacts: ExecutionArtifactReference[];
  outputArtifacts?: ExecutionArtifactReference[];
  status?: ExecutionStatus;
};

export type ExecutionRecordDTO = {
  executionId: string;
  packageId: string;
  revisionHash: string;
  provider: string;
  model: string;
  promptHash: string;
  parameters: unknown;
  inputArtifacts: ExecutionArtifactReference[];
  outputArtifacts: ExecutionArtifactReference[];
  resultHash: string;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
};

type StoredExecutionRecord = {
  executionId: string;
  packageId: string;
  revisionHash: string;
  provider: string;
  model: string;
  promptHash: string;
  parameters: unknown;
  inputArtifacts: ExecutionArtifactReference[];
  outputArtifacts: ExecutionArtifactReference[];
  resultHash: string;
  status: ExecutionStatus;
  startedAt: Date;
  finishedAt: Date;
  createdAt: Date;
};

export type ReplayExecutionResult = {
  ok: true;
  executionId: string;
  resultHash: string;
  matches: true;
};

export type ExecutionStorageAdapter = {
  findRevisionByHash(revisionHash: string): Promise<boolean>;
  artifactExists(packageId: string, bundleHash: string): Promise<boolean>;
  findExecutionById(executionId: string): Promise<StoredExecutionRecord | null>;
  createExecution(input: {
    executionId?: string;
    packageId: string;
    revisionHash: string;
    provider: string;
    model: string;
    promptHash: string;
    parameters: unknown;
    inputArtifacts: ExecutionArtifactReference[];
    outputArtifacts: ExecutionArtifactReference[];
    resultHash: string;
    status: ExecutionStatus;
    startedAt: string;
    finishedAt: string;
  }): Promise<StoredExecutionRecord>;
  listExecutions(packageId: string, limit: number): Promise<StoredExecutionRecord[]>;
};

export class ExecutionServiceError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ExecutionServiceError';
  }
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeRequiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExecutionServiceError(ERR_EXECUTION_INVALID_INPUT, MESSAGE_EXECUTION_INVALID_INPUT);
  }
  return value;
}

function normalizeHash(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ExecutionServiceError(ERR_EXECUTION_INVALID_INPUT, MESSAGE_EXECUTION_INVALID_INPUT);
  }
  const normalized = value.toLowerCase();
  if (!EXECUTION_HASH_PATTERN.test(normalized)) {
    throw new ExecutionServiceError(ERR_EXECUTION_INVALID_INPUT, MESSAGE_EXECUTION_INVALID_INPUT);
  }
  return normalized;
}

function normalizeExecutionId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ExecutionServiceError(ERR_EXECUTION_INVALID_INPUT, MESSAGE_EXECUTION_INVALID_INPUT);
  }
  const normalized = value.toLowerCase();
  if (!EXECUTION_ID_PATTERN.test(normalized)) {
    throw new ExecutionServiceError(ERR_EXECUTION_INVALID_INPUT, MESSAGE_EXECUTION_INVALID_INPUT);
  }
  return normalized;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExecutionServiceError(ERR_EXECUTION_INVALID_INPUT, MESSAGE_EXECUTION_INVALID_INPUT);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ExecutionServiceError(ERR_EXECUTION_INVALID_INPUT, MESSAGE_EXECUTION_INVALID_INPUT);
  }
  return parsed.toISOString();
}

function normalizeStatus(value: unknown): ExecutionStatus {
  if (value === 'success' || value === 'failure') {
    return value;
  }
  throw new ExecutionServiceError(ERR_EXECUTION_INVALID_INPUT, MESSAGE_EXECUTION_INVALID_INPUT);
}

function normalizeParameters(value: unknown): unknown {
  try {
    return sanitizeJsonPayload(value);
  } catch {
    throw new ExecutionServiceError(ERR_EXECUTION_INVALID_INPUT, MESSAGE_EXECUTION_INVALID_INPUT);
  }
}

function normalizeArtifacts(artifacts: unknown): ExecutionArtifactReference[] {
  if (!Array.isArray(artifacts)) {
    throw new ExecutionServiceError(ERR_EXECUTION_INVALID_INPUT, MESSAGE_EXECUTION_INVALID_INPUT);
  }

  const out: ExecutionArtifactReference[] = [];
  for (const item of artifacts) {
    if (!item || typeof item !== 'object') {
      throw new ExecutionServiceError(ERR_EXECUTION_INVALID_INPUT, MESSAGE_EXECUTION_INVALID_INPUT);
    }

    const entry = item as { bundleHash?: unknown; role?: unknown };
    out.push({
      bundleHash: normalizeHash(entry.bundleHash),
      role: normalizeRequiredString(entry.role),
    });
  }

  out.sort((a, b) => {
    const bundleOrder = compareStrings(a.bundleHash, b.bundleHash);
    if (bundleOrder !== 0) {
      return bundleOrder;
    }
    return compareStrings(a.role, b.role);
  });

  return out;
}

function artifactsEqual(a: ExecutionArtifactReference[], b: ExecutionArtifactReference[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index].bundleHash !== b[index].bundleHash || a[index].role !== b[index].role) {
      return false;
    }
  }
  return true;
}

function parametersEqual(a: unknown, b: unknown): boolean {
  return canonicalizeJson(a) === canonicalizeJson(b);
}

function toExecutionRecordDTO(record: StoredExecutionRecord): ExecutionRecordDTO {
  return {
    executionId: record.executionId,
    packageId: record.packageId,
    revisionHash: record.revisionHash,
    provider: record.provider,
    model: record.model,
    promptHash: record.promptHash,
    parameters: record.parameters,
    inputArtifacts: record.inputArtifacts.map((artifact) => ({ ...artifact })),
    outputArtifacts: record.outputArtifacts.map((artifact) => ({ ...artifact })),
    resultHash: record.resultHash,
    status: record.status,
    startedAt: record.startedAt.toISOString(),
    finishedAt: record.finishedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

function toStoredExecutionRecordFromPrisma(row: {
  executionId: string;
  packageId: string;
  revisionHash: string;
  provider: string;
  model: string;
  promptHash: string;
  parameters: unknown;
  resultHash: string;
  status: string;
  startedAt: Date;
  finishedAt: Date;
  createdAt: Date;
  inputs: { bundleHash: string; role: string }[];
  outputs: { bundleHash: string; role: string }[];
}): StoredExecutionRecord {
  return {
    executionId: row.executionId,
    packageId: row.packageId,
    revisionHash: row.revisionHash,
    provider: row.provider,
    model: row.model,
    promptHash: row.promptHash,
    parameters: row.parameters,
    inputArtifacts: row.inputs
      .map((entry) => ({ bundleHash: entry.bundleHash, role: entry.role }))
      .sort((a, b) => compareStrings(a.bundleHash, b.bundleHash) || compareStrings(a.role, b.role)),
    outputArtifacts: row.outputs
      .map((entry) => ({ bundleHash: entry.bundleHash, role: entry.role }))
      .sort((a, b) => compareStrings(a.bundleHash, b.bundleHash) || compareStrings(a.role, b.role)),
    resultHash: row.resultHash,
    status: normalizeStatus(row.status),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

function createDefaultExecutionStorageAdapter(): ExecutionStorageAdapter {
  const { prisma } = require('../utils') as { prisma: PrismaClient };

  return {
    async findRevisionByHash(revisionHash: string): Promise<boolean> {
      const revision = await prisma.revisionNode.findUnique({
        where: { revisionHash },
        select: { revisionHash: true },
      });
      return Boolean(revision);
    },

    async artifactExists(packageId: string, bundleHash: string): Promise<boolean> {
      const artifact = await prisma.artifactStoreRecord.findUnique({
        where: {
          packageId_bundleHash: {
            packageId,
            bundleHash,
          },
        },
        select: { id: true },
      });
      return Boolean(artifact);
    },

    async findExecutionById(executionId: string): Promise<StoredExecutionRecord | null> {
      const record = await prisma.executionRecord.findUnique({
        where: { executionId },
        include: {
          inputs: true,
          outputs: true,
        },
      });
      return record ? toStoredExecutionRecordFromPrisma(record) : null;
    },

    async createExecution(input): Promise<StoredExecutionRecord> {
      const created = await prisma.executionRecord.create({
        data: {
          ...(input.executionId ? { executionId: input.executionId } : {}),
          packageId: input.packageId,
          revisionHash: input.revisionHash,
          provider: input.provider,
          model: input.model,
          promptHash: input.promptHash,
          parameters: input.parameters as object,
          resultHash: input.resultHash,
          status: input.status,
          startedAt: input.startedAt,
          finishedAt: input.finishedAt,
          inputs: {
            createMany: {
              data: input.inputArtifacts.map((artifact) => ({
                bundleHash: artifact.bundleHash,
                role: artifact.role,
              })),
            },
          },
          outputs: {
            createMany: {
              data: input.outputArtifacts.map((artifact) => ({
                bundleHash: artifact.bundleHash,
                role: artifact.role,
              })),
            },
          },
        },
        include: {
          inputs: true,
          outputs: true,
        },
      });

      return toStoredExecutionRecordFromPrisma(created);
    },

    async listExecutions(packageId: string, limit: number): Promise<StoredExecutionRecord[]> {
      const rows = await prisma.executionRecord.findMany({
        where: { packageId },
        take: limit,
        orderBy: [{ startedAt: 'asc' }, { executionId: 'asc' }],
        include: {
          inputs: true,
          outputs: true,
        },
      });

      return rows.map((row) => toStoredExecutionRecordFromPrisma(row));
    },
  };
}

export class ExecutionService {
  private readonly storage: ExecutionStorageAdapter;

  constructor(storage?: ExecutionStorageAdapter) {
    this.storage = storage ?? createDefaultExecutionStorageAdapter();
  }

  async recordExecution(input: RecordExecutionInput): Promise<ExecutionRecordDTO> {
    const executionId = typeof input.executionId === 'undefined' ? undefined : normalizeExecutionId(input.executionId);
    const packageId = normalizeRequiredString(input.packageId);
    const revisionHash = normalizeHash(input.revisionHash);
    const provider = normalizeRequiredString(input.provider);
    const model = normalizeRequiredString(input.model);
    const promptHash = normalizeHash(input.promptHash);
    const parameters = normalizeParameters(input.parameters);
    const inputArtifacts = normalizeArtifacts(input.inputArtifacts);
    const outputArtifacts = normalizeArtifacts(input.outputArtifacts);
    const status = normalizeStatus(input.status);
    const startedAt = normalizeTimestamp(input.startedAt);
    const finishedAt = normalizeTimestamp(input.finishedAt);

    if (!(await this.storage.findRevisionByHash(revisionHash))) {
      throw new ExecutionServiceError(ERR_REVISION_NOT_FOUND, MESSAGE_REVISION_NOT_FOUND);
    }

    for (const artifact of [...inputArtifacts, ...outputArtifacts]) {
      const exists = await this.storage.artifactExists(packageId, artifact.bundleHash);
      if (!exists) {
        throw new ExecutionServiceError(ERR_ARTIFACT_NOT_FOUND, MESSAGE_ARTIFACT_NOT_FOUND);
      }
    }

    const resultHash = computeExecutionResultHash({
      outputs: outputArtifacts,
      status,
    });

    const created = await this.storage.createExecution({
      executionId,
      packageId,
      revisionHash,
      provider,
      model,
      promptHash,
      parameters,
      inputArtifacts,
      outputArtifacts,
      resultHash,
      status,
      startedAt,
      finishedAt,
    });

    return toExecutionRecordDTO(created);
  }

  async getExecution(query: GetExecutionQuery): Promise<ExecutionRecordDTO | null> {
    const executionId = normalizeExecutionId(query.executionId);
    const found = await this.storage.findExecutionById(executionId);
    return found ? toExecutionRecordDTO(found) : null;
  }

  async listExecutions(query: ListExecutionsQuery): Promise<ExecutionRecordDTO[]> {
    const packageId = normalizeRequiredString(query.packageId);
    const limit = typeof query.limit === 'undefined' ? 100 : query.limit;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
      throw new ExecutionServiceError(ERR_EXECUTION_INVALID_INPUT, MESSAGE_EXECUTION_INVALID_INPUT);
    }

    const rows = await this.storage.listExecutions(packageId, limit);
    return rows.map((row) => toExecutionRecordDTO(row));
  }

  async replayExecution(input: ReplayExecutionInput): Promise<ReplayExecutionResult> {
    const executionId = normalizeExecutionId(input.executionId);
    const stored = await this.storage.findExecutionById(executionId);
    if (!stored) {
      throw new ExecutionServiceError(ERR_EXECUTION_NOT_FOUND, MESSAGE_EXECUTION_NOT_FOUND);
    }

    if (!(await this.storage.findRevisionByHash(stored.revisionHash))) {
      throw new ExecutionServiceError(ERR_REVISION_NOT_FOUND, MESSAGE_REVISION_NOT_FOUND);
    }

    for (const artifact of [...stored.inputArtifacts, ...stored.outputArtifacts]) {
      const exists = await this.storage.artifactExists(stored.packageId, artifact.bundleHash);
      if (!exists) {
        throw new ExecutionServiceError(ERR_ARTIFACT_NOT_FOUND, MESSAGE_ARTIFACT_NOT_FOUND);
      }
    }

    const promptHash = normalizeHash(input.promptHash);
    const parameters = normalizeParameters(input.parameters);
    const inputArtifacts = normalizeArtifacts(input.inputArtifacts);

    if (
      promptHash !== stored.promptHash ||
      !parametersEqual(parameters, stored.parameters) ||
      !artifactsEqual(inputArtifacts, stored.inputArtifacts)
    ) {
      throw new ExecutionServiceError(ERR_EXECUTION_NON_DETERMINISTIC, MESSAGE_EXECUTION_NON_DETERMINISTIC);
    }

    const replayOutputs = typeof input.outputArtifacts === 'undefined' ? stored.outputArtifacts : normalizeArtifacts(input.outputArtifacts);
    const replayStatus = typeof input.status === 'undefined' ? stored.status : normalizeStatus(input.status);
    const replayResultHash = computeExecutionResultHash({
      outputs: replayOutputs,
      status: replayStatus,
    });

    if (replayResultHash !== stored.resultHash) {
      throw new ExecutionServiceError(ERR_EXECUTION_REPLAY_MISMATCH, MESSAGE_EXECUTION_REPLAY_MISMATCH);
    }

    return {
      ok: true,
      executionId: stored.executionId,
      resultHash: replayResultHash,
      matches: true,
    };
  }
}

export const EXECUTION_ERROR_CODES = {
  ERR_EXECUTION_INVALID_INPUT,
  ERR_REVISION_NOT_FOUND,
  ERR_ARTIFACT_NOT_FOUND,
  ERR_EXECUTION_NOT_FOUND,
  ERR_EXECUTION_NON_DETERMINISTIC,
  ERR_EXECUTION_REPLAY_MISMATCH,
} as const;



