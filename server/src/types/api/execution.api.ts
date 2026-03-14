import { z } from 'zod';

const hash64Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const executionArtifactSchema = z.object({
  bundleHash: hash64Schema,
  role: z.string().min(1),
});

export const executionRecordBodySchema = z.object({
  packageId: z.string().min(1),
  revisionHash: hash64Schema,
  provider: z.string().min(1),
  model: z.string().min(1),
  promptHash: hash64Schema,
  parameters: z.unknown(),
  inputArtifacts: z.array(executionArtifactSchema),
  outputArtifacts: z.array(executionArtifactSchema),
  status: z.enum(['success', 'failure']),
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }),
});

export const executionIdParamsSchema = z.object({
  executionId: z.string().uuid(),
});

export const executionReplayBodySchema = z.object({
  promptHash: hash64Schema,
  parameters: z.unknown(),
  inputArtifacts: z.array(executionArtifactSchema),
  outputArtifacts: z.array(executionArtifactSchema),
  status: z.enum(['success', 'failure']),
});

export type ExecutionRecordBody = z.infer<typeof executionRecordBodySchema>;
export type ExecutionIdParams = z.infer<typeof executionIdParamsSchema>;
export type ExecutionReplayBody = z.infer<typeof executionReplayBodySchema>;
