import { normalizeTaskPackagePayload, type NormalizedTaskPackage, type NormalizeFindings } from './task-package.normalize';

export type BuildTaskPackageV2Options = {
  revision: number;
  sourceSnapshotId?: string | null;
  title?: string | null;
  description?: string | null;
  origin?: 'snapshot' | 'import' | 'manual';
  now?: string;
};

export function buildTaskPackagePayloadV2(
  payload: any,
  options: BuildTaskPackageV2Options
): { payload: NormalizedTaskPackage; findings: NormalizeFindings } {
  const { normalized, findings } = normalizeTaskPackagePayload(payload, {
    revision: options.revision,
    sourceSnapshotId: options.sourceSnapshotId,
  });

  const now = options.now ?? new Date().toISOString();
  const createdAt = normalized.manifest.createdAt || now;
  const updatedAt = normalized.manifest.updatedAt || createdAt;
  const title = options.title ?? normalized.manifest.title ?? '';
  const description = options.description ?? normalized.manifest.description;
  const origin = options.origin ?? normalized.history.origin;

  const materialized: NormalizedTaskPackage = {
    ...normalized,
    manifest: {
      ...normalized.manifest,
      schemaVersion: 'tpkg-0.2',
      createdAt,
      updatedAt,
      title,
      description,
      capabilities: {
        applyModes: ['bootstrap', 'constrain', 'review'],
        conflictHandling: 'report_only',
      },
    },
    history: {
      ...normalized.history,
      origin,
      revision: options.revision,
    },
    compat: {
      accepts: ['tpkg-0.1'],
      downgradeStrategy: 'lossy-allowed',
    },
  };

  return { payload: materialized, findings };
}
