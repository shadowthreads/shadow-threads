import { z } from 'zod';

const hash64Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const migrationExportBodySchema = z.object({
  rootRevisionHash: hash64Schema,
});

export const migrationZipBodySchema = z.object({
  zipPath: z.string().min(1),
});

export type MigrationExportBody = z.infer<typeof migrationExportBodySchema>;
export type MigrationZipBody = z.infer<typeof migrationZipBodySchema>;
