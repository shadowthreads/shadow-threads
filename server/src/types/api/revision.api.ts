import { z } from 'zod';

const hash64Schema = z.string().regex(/^[0-9a-f]{64}$/);
const nullableHash64Schema = z.union([hash64Schema, z.null()]);

export const revisionArtifactSchema = z.object({
  bundleHash: hash64Schema,
  role: z.string().min(1),
});

export const revisionMetadataSchema = z.object({
  author: z.string().min(1),
  message: z.string().min(1),
  createdBy: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  source: z.enum(['human', 'ai', 'migration', 'system']),
  tags: z.array(z.string().min(1)).optional().default([]),
});

export const revisionCreateBodySchema = z.object({
  packageId: z.string().min(1),
  parentRevisionHash: nullableHash64Schema.optional().default(null),
  artifacts: z.array(revisionArtifactSchema).min(1),
  metadata: revisionMetadataSchema,
});

export const revisionHashParamsSchema = z.object({
  revisionHash: hash64Schema,
});

export const revisionPackageParamsSchema = z.object({
  packageId: z.string().min(1),
});

export const revisionListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export type RevisionCreateBody = z.infer<typeof revisionCreateBodySchema>;
export type RevisionHashParams = z.infer<typeof revisionHashParamsSchema>;
export type RevisionPackageParams = z.infer<typeof revisionPackageParamsSchema>;
export type RevisionListQuery = z.infer<typeof revisionListQuerySchema>;
