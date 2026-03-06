import { z } from 'zod';

const hash64Schema = z.string().regex(/^[0-9a-f]{64}$/);
const nullableHash64Schema = z.union([hash64Schema, z.null()]);
const nullableStringSchema = z.union([z.string().min(1), z.null()]);

export const artifactReferenceSchema = z.object({
  bundleHash: hash64Schema,
  role: z.string().min(1),
});

export const artifactIdentitySchema = z.object({
  packageId: z.string().min(1),
  revisionId: nullableStringSchema.optional().default(null),
  revisionHash: nullableHash64Schema.optional().default(null),
});

export const artifactCreateBodySchema = z.object({
  schema: z.string().min(1),
  identity: artifactIdentitySchema,
  payload: z.unknown(),
  references: z.array(artifactReferenceSchema).optional().default([]),
});

export const artifactRouteParamsSchema = z.object({
  packageId: z.string().min(1),
  bundleHash: hash64Schema,
});

export type ArtifactCreateBody = z.infer<typeof artifactCreateBodySchema>;
export type ArtifactRouteParams = z.infer<typeof artifactRouteParamsSchema>;
