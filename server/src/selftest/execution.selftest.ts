import {
  computeExecutionResultHash,
  type ExecutionArtifactReference,
  type ExecutionStatus,
} from '../lib/execution-hash';
import {
  ExecutionService,
  type ExecutionStorageAdapter,
  type ExecutionRecordDTO,
  ExecutionServiceError,
  EXECUTION_ERROR_CODES,
} from '../services/execution.service';

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

const PACKAGE_ID = 'execution-selftest-package';
const REVISION_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const INPUT_BUNDLE_HASH = '1111111111111111111111111111111111111111111111111111111111111111';
const OUTPUT_BUNDLE_HASH = '2222222222222222222222222222222222222222222222222222222222222222';
const EXECUTION_ID = '123e4567-e89b-42d3-a456-426614174000';
const PROMPT_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function assertCondition(condition: boolean): void {
  if (!condition) {
    throw new Error('execution_selftest_failed');
  }
}

function cloneArtifacts(items: ExecutionArtifactReference[]): ExecutionArtifactReference[] {
  return items.map((item) => ({ bundleHash: item.bundleHash, role: item.role }));
}

function createInMemoryExecutionAdapter(): {
  adapter: ExecutionStorageAdapter;
  revisions: Set<string>;
  artifacts: Set<string>;
} {
  const revisions = new Set<string>();
  const artifacts = new Set<string>();
  const executions = new Map<string, StoredExecutionRecord>();

  const adapter: ExecutionStorageAdapter = {
    async findRevisionByHash(revisionHash: string): Promise<boolean> {
      return revisions.has(revisionHash);
    },

    async artifactExists(packageId: string, bundleHash: string): Promise<boolean> {
      return artifacts.has(`${packageId}:${bundleHash}`);
    },

    async findExecutionById(executionId: string): Promise<StoredExecutionRecord | null> {
      return executions.get(executionId) ?? null;
    },

    async createExecution(input): Promise<StoredExecutionRecord> {
      const executionId = input.executionId ?? '123e4567-e89b-42d3-a456-426614174001';
      const createdAt = new Date('2026-03-06T00:00:02.000Z');
      const stored: StoredExecutionRecord = {
        executionId,
        packageId: input.packageId,
        revisionHash: input.revisionHash,
        provider: input.provider,
        model: input.model,
        promptHash: input.promptHash,
        parameters: input.parameters,
        inputArtifacts: cloneArtifacts(input.inputArtifacts),
        outputArtifacts: cloneArtifacts(input.outputArtifacts),
        resultHash: input.resultHash,
        status: input.status,
        startedAt: new Date(input.startedAt),
        finishedAt: new Date(input.finishedAt),
        createdAt,
      };
      executions.set(executionId, stored);
      return stored;
    },

    async listExecutions(packageId: string, limit: number): Promise<StoredExecutionRecord[]> {
      const rows: StoredExecutionRecord[] = [];
      for (const execution of executions.values()) {
        if (execution.packageId === packageId) {
          rows.push(execution);
        }
      }
      rows.sort((a, b) => {
        const timeDiff = a.startedAt.getTime() - b.startedAt.getTime();
        if (timeDiff !== 0) {
          return timeDiff < 0 ? -1 : 1;
        }
        return compareStrings(a.executionId, b.executionId);
      });
      return rows.slice(0, limit);
    },
  };

  return { adapter, revisions, artifacts };
}

function addArtifact(artifacts: Set<string>, packageId: string, bundleHash: string): void {
  artifacts.add(`${packageId}:${bundleHash}`);
}

async function runExecutionSelftest(): Promise<void> {
  const memory = createInMemoryExecutionAdapter();
  const service = new ExecutionService(memory.adapter);

  memory.revisions.add(REVISION_HASH);
  addArtifact(memory.artifacts, PACKAGE_ID, INPUT_BUNDLE_HASH);
  addArtifact(memory.artifacts, PACKAGE_ID, OUTPUT_BUNDLE_HASH);

  const expectedHashA = computeExecutionResultHash({
    outputs: [
      { bundleHash: OUTPUT_BUNDLE_HASH, role: 'result' },
      { bundleHash: INPUT_BUNDLE_HASH, role: 'evidence' },
    ],
    status: 'success',
  });

  const expectedHashB = computeExecutionResultHash({
    outputs: [
      { bundleHash: INPUT_BUNDLE_HASH, role: 'evidence' },
      { bundleHash: OUTPUT_BUNDLE_HASH, role: 'result' },
    ],
    status: 'success',
  });

  assertCondition(expectedHashA === expectedHashB);

  const recorded = await service.recordExecution({
    executionId: EXECUTION_ID,
    packageId: PACKAGE_ID,
    revisionHash: REVISION_HASH,
    provider: 'openai',
    model: 'gpt-test',
    promptHash: PROMPT_HASH,
    parameters: {
      temperature: 0,
      maxTokens: 256,
    },
    inputArtifacts: [{ bundleHash: INPUT_BUNDLE_HASH, role: 'context' }],
    outputArtifacts: [
      { bundleHash: OUTPUT_BUNDLE_HASH, role: 'result' },
      { bundleHash: INPUT_BUNDLE_HASH, role: 'evidence' },
    ],
    status: 'success',
    startedAt: '2026-03-06T00:00:00.000Z',
    finishedAt: '2026-03-06T00:00:01.000Z',
  });

  assertCondition(recorded.resultHash === expectedHashA);

  const loaded = await service.getExecution({ executionId: EXECUTION_ID });
  assertCondition(loaded !== null);
  assertCondition((loaded as ExecutionRecordDTO).resultHash === recorded.resultHash);

  const listed = await service.listExecutions({ packageId: PACKAGE_ID, limit: 10 });
  assertCondition(listed.length === 1);
  assertCondition(listed[0].executionId === EXECUTION_ID);

  let missingArtifactCaught = false;
  try {
    await service.recordExecution({
      executionId: '123e4567-e89b-42d3-a456-426614174010',
      packageId: PACKAGE_ID,
      revisionHash: REVISION_HASH,
      provider: 'openai',
      model: 'gpt-test',
      promptHash: PROMPT_HASH,
      parameters: { temperature: 0 },
      inputArtifacts: [{ bundleHash: '3333333333333333333333333333333333333333333333333333333333333333', role: 'context' }],
      outputArtifacts: [{ bundleHash: OUTPUT_BUNDLE_HASH, role: 'result' }],
      status: 'success',
      startedAt: '2026-03-06T00:00:00.000Z',
      finishedAt: '2026-03-06T00:00:01.000Z',
    });
  } catch (error) {
    if (
      error instanceof ExecutionServiceError &&
      error.code === EXECUTION_ERROR_CODES.ERR_ARTIFACT_NOT_FOUND
    ) {
      missingArtifactCaught = true;
    } else {
      throw error;
    }
  }
  assertCondition(missingArtifactCaught);

  const replayed = await service.replayExecution({
    executionId: EXECUTION_ID,
    promptHash: PROMPT_HASH,
    parameters: {
      temperature: 0,
      maxTokens: 256,
    },
    inputArtifacts: [{ bundleHash: INPUT_BUNDLE_HASH, role: 'context' }],
  });
  assertCondition(replayed.matches === true);
  assertCondition(replayed.resultHash === recorded.resultHash);

  let nonDeterministicCaught = false;
  try {
    await service.replayExecution({
      executionId: EXECUTION_ID,
      promptHash: PROMPT_HASH,
      parameters: {
        temperature: 1,
        maxTokens: 256,
      },
      inputArtifacts: [{ bundleHash: INPUT_BUNDLE_HASH, role: 'context' }],
    });
  } catch (error) {
    if (
      error instanceof ExecutionServiceError &&
      error.code === EXECUTION_ERROR_CODES.ERR_EXECUTION_NON_DETERMINISTIC
    ) {
      nonDeterministicCaught = true;
    } else {
      throw error;
    }
  }
  assertCondition(nonDeterministicCaught);

  let replayMismatchCaught = false;
  try {
    await service.replayExecution({
      executionId: EXECUTION_ID,
      promptHash: PROMPT_HASH,
      parameters: {
        temperature: 0,
        maxTokens: 256,
      },
      inputArtifacts: [{ bundleHash: INPUT_BUNDLE_HASH, role: 'context' }],
      outputArtifacts: [{ bundleHash: OUTPUT_BUNDLE_HASH, role: 'different-role' }],
    });
  } catch (error) {
    if (
      error instanceof ExecutionServiceError &&
      error.code === EXECUTION_ERROR_CODES.ERR_EXECUTION_REPLAY_MISMATCH
    ) {
      replayMismatchCaught = true;
    } else {
      throw error;
    }
  }
  assertCondition(replayMismatchCaught);
}

if (require.main === module) {
  runExecutionSelftest()
    .then(() => {
      process.stdout.write('EXECUTION_SELFTEST_OK\n');
    })
    .catch(() => {
      process.stdout.write('EXECUTION_SELFTEST_FAIL\n');
      process.exit(1);
    });
}
