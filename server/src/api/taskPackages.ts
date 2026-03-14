/**
 * TaskPackage API Router (thin controller)
 * - auth + validate + service call + error mapping only
 */

import { LLMProvider } from '@prisma/client';
import { Router, type Response } from 'express';
import { z } from 'zod';

import { asyncHandler, requireAuth, validate } from '../middleware';
import { idParamSchema } from '../middleware/validation';
import { TaskPackageService } from '../services/task-package.service';
import { TransferPackageService } from '../services/transfer-package.service';
import { ArtifactBundleService } from '../services/artifact-bundle.service';
import { ArtifactStoreService } from '../services/artifact-store.service';

const router = Router();
const svc = new TaskPackageService();
const transferSvc = new TransferPackageService();
const artifactBundleSvc = new ArtifactBundleService();
const artifactStoreSvc = new ArtifactStoreService();

const targetSchemaVersionSchema = z.enum(['tpkg-0.1', 'tpkg-0.2']);

/** Express params may be string | string[] */
function paramToString(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value ?? '');
}

function extractErrorCode(err: unknown): unknown {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return (err as any).code ?? err.message;
  if (err && typeof err === 'object' && 'code' in err) return (err as any).code;
  return undefined;
}

function normalizeServiceCode(code: unknown):
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'NO_REVISION'
  | 'INVALID_INPUT'
  | 'CONFLICT_RETRY_EXHAUSTED'
  | 'E_INVALID_INPUT'
  | 'E_LLM_DELTA_CONFLICT'
  | 'E_TRANSFER_INVALID'
  | 'E_TRANSFER_NON_JSON_SAFE'
  | 'UNKNOWN' {
  if (typeof code !== 'string') return 'UNKNOWN';
  if (
    code === 'NOT_FOUND' ||
    code === 'FORBIDDEN' ||
    code === 'NO_REVISION' ||
    code === 'INVALID_INPUT' ||
    code === 'CONFLICT_RETRY_EXHAUSTED' ||
    code === 'E_INVALID_INPUT' ||
    code === 'E_LLM_DELTA_CONFLICT' ||
    code === 'E_TRANSFER_INVALID' ||
    code === 'E_TRANSFER_NON_JSON_SAFE'
  ) {
    return code;
  }
  return 'UNKNOWN';
}

function errorMessageForCode(code: ReturnType<typeof normalizeServiceCode>): string {
  if (code === 'E_INVALID_INPUT') return "llmDeltaMode must be 'best_effort' or 'strict'";
  if (code === 'E_LLM_DELTA_CONFLICT') return 'LLM delta contains conflicts';
  if (code === 'E_TRANSFER_INVALID') return 'Transfer package input is invalid';
  if (code === 'E_TRANSFER_NON_JSON_SAFE') return 'Transfer package contains non JSON-safe value';
  return code;
}

function sendServiceError(res: Response, code: unknown): void {
  const normalized = normalizeServiceCode(code);
  const status =
    normalized === 'NOT_FOUND'
      ? 404
      : normalized === 'FORBIDDEN'
      ? 403
      : normalized === 'CONFLICT_RETRY_EXHAUSTED' || normalized === 'E_LLM_DELTA_CONFLICT'
      ? 409
      : 400;

  res.status(status).json({
    success: false,
    error: {
      code: normalized,
      message: errorMessageForCode(normalized),
    },
  });
}

const createFromSnapshotSchema = z.object({
  sourceSnapshotId: z.string().uuid(),
  title: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  targetSchemaVersion: targetSchemaVersionSchema.optional(),
});
type CreateFromSnapshotBody = z.infer<typeof createFromSnapshotSchema>;

router.post(
  '/from-snapshot',
  requireAuth,
  validate({ body: createFromSnapshotSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const { sourceSnapshotId, title, description, targetSchemaVersion } = req.body as CreateFromSnapshotBody;

    try {
      const input = { sourceSnapshotId, title, description };
      const data = targetSchemaVersion
        ? await svc.createFromSnapshot(userId, input, { targetSchemaVersion })
        : await svc.createFromSnapshot(userId, input);
      res.json({ success: true, data });
    } catch (err: unknown) {
      sendServiceError(res, extractErrorCode(err));
    }
  })
);

const importPackageSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  payload: z.unknown(),
  targetSchemaVersion: targetSchemaVersionSchema.optional(),
});
type ImportPackageBody = z.infer<typeof importPackageSchema>;

const transferDomainValues = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'] as const;
type TransferDomain = (typeof transferDomainValues)[number];
const transferDomainSet = new Set<string>(transferDomainValues);

const transferBodySchema = z.object({
  revisionId: z.string().uuid().optional(),
  include: z
    .object({
      closureContractV1: z.boolean().optional(),
      applyReportV1Hash: z.boolean().optional(),
      executionRecordV1Hash: z.boolean().optional(),
    })
    .optional(),
  closureContractV1: z
    .object({
      schema: z.literal('closure-contract-1'),
      proposedHash: z.string(),
      acceptedHash: z.string(),
    })
    .nullable()
    .optional(),
  applyReportV1Hash: z.string().nullable().optional(),
  executionRecordV1Hash: z.string().nullable().optional(),
  trunk: z
    .object({
      intent: z
        .object({
          primary: z.string().nullable().optional(),
          successCriteria: z.array(z.string()).optional(),
          nonGoals: z.array(z.string()).optional(),
        })
        .optional(),
      stateDigest: z
        .object({
          facts: z.array(z.string()).optional(),
          decisions: z.array(z.string()).optional(),
          constraints: z.array(z.string()).optional(),
          risks: z.array(z.string()).optional(),
          assumptions: z.array(z.string()).optional(),
          openLoops: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  continuation: z
    .object({
      nextActions: z
        .array(
          z.object({
            code: z.string(),
            message: z.string(),
            expectedOutput: z.string().nullable().optional(),
            domains: z.array(z.string()).optional(),
          })
        )
        .optional(),
      validationChecklist: z
        .array(
          z.object({
            code: z.string(),
            message: z.string(),
            severity: z.enum(['must', 'should']).optional(),
          })
        )
        .optional(),
    })
    .optional(),
});
type TransferBody = z.infer<typeof transferBodySchema>;
type TransferNextActionBody = NonNullable<NonNullable<TransferBody['continuation']>['nextActions']>[number];

function sendTransferInputError(res: Response, message: 'Invalid transfer package request' | 'Invalid domain in nextActions'): void {
  res.status(400).json({
    success: false,
    error: {
      code: 'E_INVALID_INPUT',
      message,
    },
  });
}

function hasInvalidTransferDomain(nextActions: TransferNextActionBody[] | undefined): boolean {
  if (!Array.isArray(nextActions)) return false;
  for (const nextAction of nextActions) {
    if (!Array.isArray(nextAction.domains)) continue;
    for (const domain of nextAction.domains) {
      if (!transferDomainSet.has(domain)) return true;
    }
  }
  return false;
}

function normalizeTransferDomains(domains: string[] | undefined): TransferDomain[] {
  if (!Array.isArray(domains)) return [];
  const normalized = domains.filter((domain): domain is TransferDomain => transferDomainSet.has(domain));
  return normalized;
}

const transferVerifyBodySchema = z.object({
  transferPackageV1: z.unknown(),
});
type TransferVerifyBody = z.infer<typeof transferVerifyBodySchema>;

const transferIngestBodySchema = z.object({
  transferPackageV1: z.unknown(),
  include: z
    .object({
      closureContractV1: z.boolean().optional(),
      applyReportV1Hash: z.boolean().optional(),
      executionRecordV1Hash: z.boolean().optional(),
    })
    .optional(),
  bindings: z
    .object({
      closureContractV1: z
        .object({
          schema: z.literal('closure-contract-1'),
          proposedHash: z.string(),
          acceptedHash: z.string(),
        })
        .nullable()
        .optional(),
      applyReportV1Hash: z.string().nullable().optional(),
      executionRecordV1Hash: z.string().nullable().optional(),
    })
    .optional(),
  createdAt: z.string().nullable().optional(),
});
type TransferIngestBody = z.infer<typeof transferIngestBodySchema>;

const lineageVerifyBodySchema = z.object({
  lineageBindingV1: z.unknown(),
});
type LineageVerifyBody = z.infer<typeof lineageVerifyBodySchema>;

const handoffVerifyBodySchema = z.object({
  handoffRecordV1: z.unknown(),
});
type HandoffVerifyBody = z.infer<typeof handoffVerifyBodySchema>;

const bundleBuildBodySchema = z.object({
  transferPackageV1: z.unknown(),
  lineageBindingV1: z.unknown(),
  handoffRecordV1: z.unknown(),
  closureContractV1: z.unknown().nullable().optional(),
  identity: z
    .object({
      revisionId: z.string().nullable().optional(),
      revisionHash: z.string().nullable().optional(),
    })
    .optional(),
  createdAt: z.string().nullable().optional(),
  notes: z.array(z.string()).optional(),
});
type BundleBuildBody = z.infer<typeof bundleBuildBodySchema>;

const bundleVerifyBodySchema = z.object({
  artifactBundleV1: z.unknown(),
});
type BundleVerifyBody = z.infer<typeof bundleVerifyBodySchema>;

const bundleStoreBodySchema = z.object({
  artifactBundleV1: z.unknown(),
  createdAt: z.string().nullable().optional(),
  notes: z.array(z.string()).optional(),
});
type BundleStoreBody = z.infer<typeof bundleStoreBodySchema>;
const bundleStoreParamSchema = z.object({
  id: z.string().uuid(),
  bundleHash: z.string(),
});

function sendTransferConsumerInputError(
  res: Response,
  message: 'Invalid transfer verify request' | 'Invalid transfer ingest request'
): void {
  res.status(400).json({
    success: false,
    error: {
      code: 'E_INVALID_INPUT',
      message,
    },
  });
}

function sendLineageInputError(res: Response): void {
  res.status(400).json({
    success: false,
    error: {
      code: 'E_INVALID_INPUT',
      message: 'Invalid lineage verify request',
    },
  });
}

function sendHandoffInputError(res: Response): void {
  res.status(400).json({
    success: false,
    error: {
      code: 'E_INVALID_INPUT',
      message: 'Invalid handoff verify request',
    },
  });
}

function sendBundleInputError(res: Response, message: 'Invalid bundle build request' | 'Invalid bundle verify request'): void {
  res.status(400).json({
    success: false,
    error: {
      code: 'E_INVALID_INPUT',
      message,
    },
  });
}

function sendStoreInputError(
  res: Response,
  message: 'Invalid bundle store request' | 'Invalid bundle store verify request'
): void {
  res.status(400).json({
    success: false,
    error: {
      code: 'E_INVALID_INPUT',
      message,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function extractTransferBodyPackageId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const identity = value.identity;
  if (!isRecord(identity)) return null;
  return typeof identity.packageId === 'string' ? identity.packageId : null;
}

function extractLineageBodyPackageId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const identity = value.identity;
  if (!isRecord(identity)) return null;
  return typeof identity.packageId === 'string' ? identity.packageId : null;
}

function extractHandoffBodyPackageId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const identity = value.identity;
  if (!isRecord(identity)) return null;
  return typeof identity.packageId === 'string' ? identity.packageId : null;
}

function extractBundleArtifactPackageId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const identity = value.identity;
  if (!isRecord(identity)) return null;
  return typeof identity.packageId === 'string' ? identity.packageId : null;
}

function extractBundleBodyPackageId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const identity = value.identity;
  if (!isRecord(identity)) return null;
  return typeof identity.packageId === 'string' ? identity.packageId : null;
}

router.post(
  '/import',
  requireAuth,
  validate({ body: importPackageSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const { title, description, payload, targetSchemaVersion } = req.body as ImportPackageBody;

    try {
      const input = { title, description, payload };
      const data = targetSchemaVersion
        ? await svc.importPackage(userId, input, { targetSchemaVersion })
        : await svc.importPackage(userId, input);
      res.json({ success: true, data });
    } catch (err: unknown) {
      sendServiceError(res, extractErrorCode(err));
    }
  })
);

router.get(
  '/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const packageId = paramToString((req.params as { id?: string | string[] }).id);

    try {
      const data = await svc.getPackage(userId, packageId);
      res.json({ success: true, data });
    } catch (err: unknown) {
      sendServiceError(res, extractErrorCode(err));
    }
  })
);

const createRevisionSchema = z.object({
  payload: z.unknown(),
  schemaVersion: z.string().optional(),
  summary: z.string().optional(),
  setCurrent: z.boolean().optional(),
  parentRevisionId: z.string().uuid().nullable().optional(),
});
type CreateRevisionBody = z.infer<typeof createRevisionSchema>;

router.post(
  '/:id/revisions',
  requireAuth,
  validate({ params: idParamSchema, body: createRevisionSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const body = req.body as CreateRevisionBody;

    try {
      const data = await svc.createRevision(userId, packageId, {
        payload: body.payload ?? {},
        schemaVersion: body.schemaVersion,
        summary: body.summary,
        setCurrent: body.setCurrent,
        parentRevisionId: body.parentRevisionId,
      });
      res.json({ success: true, data });
    } catch (err: unknown) {
      sendServiceError(res, extractErrorCode(err));
    }
  })
);

const setCurrentRevisionSchema = z.object({
  revisionId: z.string().uuid(),
});
type SetCurrentRevisionBody = z.infer<typeof setCurrentRevisionSchema>;

router.post(
  '/:id/set-current',
  requireAuth,
  validate({ params: idParamSchema, body: setCurrentRevisionSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const { revisionId } = req.body as SetCurrentRevisionBody;

    try {
      const data = await svc.setCurrentRevision(userId, packageId, revisionId);
      res.json({ success: true, data });
    } catch (err: unknown) {
      sendServiceError(res, extractErrorCode(err));
    }
  })
);

router.get(
  '/:id/export',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const packageId = paramToString((req.params as { id?: string | string[] }).id);

    try {
      const data = await svc.exportPackage(userId, packageId);
      res.json({ success: true, data });
    } catch (err: unknown) {
      sendServiceError(res, extractErrorCode(err));
    }
  })
);

router.post(
  '/:id/transfer',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const parsed = transferBodySchema.safeParse(req.body ?? {});

    if (!parsed.success) {
      sendTransferInputError(res, 'Invalid transfer package request');
      return;
    }

    const body = parsed.data as TransferBody;
    if (hasInvalidTransferDomain(body.continuation?.nextActions)) {
      sendTransferInputError(res, 'Invalid domain in nextActions');
      return;
    }

    try {
      const transferPackageV1 = await transferSvc.createTransferPackage(userId, packageId, {
        revisionId: body.revisionId,
        include: {
          closureContractV1: body.include?.closureContractV1 === true,
          applyReportV1Hash: body.include?.applyReportV1Hash === true,
          executionRecordV1Hash: body.include?.executionRecordV1Hash === true,
        },
        closureContractV1: body.closureContractV1 ?? null,
        applyReportV1Hash: typeof body.applyReportV1Hash === 'string' ? body.applyReportV1Hash : null,
        executionRecordV1Hash: typeof body.executionRecordV1Hash === 'string' ? body.executionRecordV1Hash : null,
        trunk: body.trunk
          ? {
              intent: body.trunk.intent
                ? {
                    primary: body.trunk.intent.primary ?? null,
                    successCriteria: body.trunk.intent.successCriteria ?? [],
                    nonGoals: body.trunk.intent.nonGoals ?? [],
                  }
                : undefined,
              stateDigest: body.trunk.stateDigest
                ? {
                    facts: body.trunk.stateDigest.facts ?? [],
                    decisions: body.trunk.stateDigest.decisions ?? [],
                    constraints: body.trunk.stateDigest.constraints ?? [],
                    risks: body.trunk.stateDigest.risks ?? [],
                    assumptions: body.trunk.stateDigest.assumptions ?? [],
                    openLoops: body.trunk.stateDigest.openLoops ?? [],
                  }
                : undefined,
            }
          : undefined,
        continuation: body.continuation
          ? {
              nextActions: body.continuation.nextActions?.map((entry) => ({
                code: entry.code,
                message: entry.message,
                expectedOutput: entry.expectedOutput ?? null,
                domains: normalizeTransferDomains(entry.domains),
              })),
              validationChecklist: body.continuation.validationChecklist?.map((entry) => ({
                code: entry.code,
                message: entry.message,
                severity: entry.severity ?? 'should',
              })),
            }
          : undefined,
      });
      const lineageBindingV1 = transferSvc.buildLineageBindingForTransferFlowV1({
        transferPackageV1,
        include: {
          closure: body.include?.closureContractV1 === true,
          execution:
            body.include?.applyReportV1Hash === true || body.include?.executionRecordV1Hash === true,
          handoff: false,
        },
        closureContractV1: body.closureContractV1 ?? null,
        applyReportV1Hash: typeof body.applyReportV1Hash === 'string' ? body.applyReportV1Hash : null,
        executionRecordV1Hash: typeof body.executionRecordV1Hash === 'string' ? body.executionRecordV1Hash : null,
        createdAt: null,
      });

      res.json({ transferPackageV1, lineageBindingV1 });
    } catch (err: unknown) {
      sendServiceError(res, extractErrorCode(err));
    }
  })
);

router.post(
  '/:id/transfer/verify',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const parsed = transferVerifyBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendTransferConsumerInputError(res, 'Invalid transfer verify request');
      return;
    }

    const body = parsed.data as TransferVerifyBody;
    const bodyPackageId = extractTransferBodyPackageId(body.transferPackageV1);
    if (bodyPackageId !== null && bodyPackageId !== packageId) {
      sendTransferConsumerInputError(res, 'Invalid transfer verify request');
      return;
    }

    try {
      const result = transferSvc.verifyTransferPackageV1({
        transferPackageV1: body.transferPackageV1,
      });
      res.json(result);
    } catch (_err: unknown) {
      sendTransferConsumerInputError(res, 'Invalid transfer verify request');
    }
  })
);

router.post(
  '/:id/transfer/ingest',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const parsed = transferIngestBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendTransferConsumerInputError(res, 'Invalid transfer ingest request');
      return;
    }

    const body = parsed.data as TransferIngestBody;
    const bodyPackageId = extractTransferBodyPackageId(body.transferPackageV1);
    if (bodyPackageId !== null && bodyPackageId !== packageId) {
      sendTransferConsumerInputError(res, 'Invalid transfer ingest request');
      return;
    }

    try {
      const createdAt = typeof body.createdAt === 'string' ? body.createdAt : body.createdAt === null ? null : null;
      const handoffRecordV1 = transferSvc.ingestTransferPackageV1({
        transferPackageV1: body.transferPackageV1,
        include: {
          closureContractV1: body.include?.closureContractV1 === true,
          applyReportV1Hash: body.include?.applyReportV1Hash === true,
          executionRecordV1Hash: body.include?.executionRecordV1Hash === true,
        },
        bindings: {
          closureContractV1: body.bindings?.closureContractV1 ?? null,
          applyReportV1Hash: typeof body.bindings?.applyReportV1Hash === 'string' ? body.bindings.applyReportV1Hash : null,
          executionRecordV1Hash:
            typeof body.bindings?.executionRecordV1Hash === 'string' ? body.bindings.executionRecordV1Hash : null,
        },
        createdAt,
      });
      const lineageBindingV1 = handoffRecordV1.lineageBindingV1;
      res.json({ handoffRecordV1, lineageBindingV1 });
    } catch (_err: unknown) {
      sendTransferConsumerInputError(res, 'Invalid transfer ingest request');
    }
  })
);

router.post(
  '/:id/bundle/build',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const parsed = bundleBuildBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendBundleInputError(res, 'Invalid bundle build request');
      return;
    }

    const body = parsed.data as BundleBuildBody;
    const tpId = extractBundleArtifactPackageId(body.transferPackageV1);
    const lbId = extractBundleArtifactPackageId(body.lineageBindingV1);
    const hoId = extractBundleArtifactPackageId(body.handoffRecordV1);
    if (tpId === null || lbId === null || hoId === null) {
      sendBundleInputError(res, 'Invalid bundle build request');
      return;
    }
    if (tpId !== lbId || lbId !== hoId || packageId !== tpId) {
      sendBundleInputError(res, 'Invalid bundle build request');
      return;
    }

    try {
      const artifactBundleV1 = artifactBundleSvc.buildArtifactBundleV1({
        identity: {
          packageId: tpId,
          revisionId:
            typeof body.identity?.revisionId === 'string'
              ? body.identity.revisionId
              : body.identity?.revisionId === null
              ? null
              : null,
          revisionHash:
            typeof body.identity?.revisionHash === 'string'
              ? body.identity.revisionHash
              : body.identity?.revisionHash === null
              ? null
              : null,
        },
        artifacts: {
          transferPackageV1: body.transferPackageV1,
          lineageBindingV1: body.lineageBindingV1,
          handoffRecordV1: body.handoffRecordV1,
          closureContractV1: body.closureContractV1 ?? null,
        },
        diagnostics: {
          notes: body.notes ?? [],
        },
        createdAt: typeof body.createdAt === 'string' ? body.createdAt : body.createdAt === null ? null : null,
      });
      res.json({ artifactBundleV1 });
    } catch (_err: unknown) {
      sendBundleInputError(res, 'Invalid bundle build request');
    }
  })
);

router.post(
  '/:id/bundle/verify',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const parsed = bundleVerifyBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendBundleInputError(res, 'Invalid bundle verify request');
      return;
    }

    const body = parsed.data as BundleVerifyBody;
    const bodyPackageId = extractBundleBodyPackageId(body.artifactBundleV1);
    if (bodyPackageId === null || bodyPackageId !== packageId) {
      sendBundleInputError(res, 'Invalid bundle verify request');
      return;
    }

    try {
      const result = artifactBundleSvc.verifyArtifactBundleV1({
        artifactBundleV1: body.artifactBundleV1,
      });
      res.json(result);
    } catch (_err: unknown) {
      sendBundleInputError(res, 'Invalid bundle verify request');
    }
  })
);

router.post(
  '/:id/bundle/store',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const parsed = bundleStoreBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendStoreInputError(res, 'Invalid bundle store request');
      return;
    }

    const body = parsed.data as BundleStoreBody;
    const bodyPackageId = extractBundleBodyPackageId(body.artifactBundleV1);
    if (bodyPackageId === null || bodyPackageId !== packageId) {
      sendStoreInputError(res, 'Invalid bundle store request');
      return;
    }

    try {
      const result = await artifactStoreSvc.saveBundleV1({
        artifactBundleV1: body.artifactBundleV1,
        createdAt: typeof body.createdAt === 'string' ? body.createdAt : body.createdAt === null ? null : null,
        notes: body.notes ?? [],
      });
      res.json(result);
    } catch (_err: unknown) {
      sendStoreInputError(res, 'Invalid bundle store request');
    }
  })
);

router.get(
  '/:id/bundle/store/:bundleHash',
  requireAuth,
  validate({ params: bundleStoreParamSchema }),
  asyncHandler(async (req, res) => {
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const bundleHash = paramToString((req.params as { bundleHash?: string | string[] }).bundleHash);

    const result = await artifactStoreSvc.getBundleV1({
      packageId,
      bundleHash,
    });
    res.json(result);
  })
);

router.post(
  '/:id/bundle/store/:bundleHash/verify',
  requireAuth,
  validate({ params: bundleStoreParamSchema }),
  asyncHandler(async (req, res) => {
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const bundleHash = paramToString((req.params as { bundleHash?: string | string[] }).bundleHash);
    if (bundleHash.length === 0) {
      sendStoreInputError(res, 'Invalid bundle store verify request');
      return;
    }

    try {
      const result = await artifactStoreSvc.verifyStoredBundleV1({
        packageId,
        bundleHash,
      });
      if (result === null) {
        res.json({ ok: false });
        return;
      }
      res.json(result);
    } catch (_err: unknown) {
      sendStoreInputError(res, 'Invalid bundle store verify request');
    }
  })
);

router.post(
  '/:id/handoff/verify',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const parsed = handoffVerifyBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendHandoffInputError(res);
      return;
    }

    const body = parsed.data as HandoffVerifyBody;
    const bodyPackageId = extractHandoffBodyPackageId(body.handoffRecordV1);
    if (bodyPackageId === null || bodyPackageId !== packageId) {
      sendHandoffInputError(res);
      return;
    }

    try {
      const result = transferSvc.verifyHandoffRecordV1({
        handoffRecordV1: body.handoffRecordV1,
      });
      res.json(result);
    } catch (_err: unknown) {
      sendHandoffInputError(res);
    }
  })
);

router.post(
  '/:id/lineage/verify',
  requireAuth,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const parsed = lineageVerifyBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendLineageInputError(res);
      return;
    }

    const body = parsed.data as LineageVerifyBody;
    const bodyPackageId = extractLineageBodyPackageId(body.lineageBindingV1);
    if (bodyPackageId === null || bodyPackageId !== packageId) {
      sendLineageInputError(res);
      return;
    }

    try {
      const result = transferSvc.verifyLineageBindingV1({
        lineageBindingV1: body.lineageBindingV1,
      });
      res.json(result);
    } catch (_err: unknown) {
      sendLineageInputError(res);
    }
  })
);

const applySchema = z.object({
  userQuestion: z.string().min(1).max(10000),
  mode: z.enum(['bootstrap', 'constrain', 'review']).optional(),
  provider: z.nativeEnum(LLMProvider).optional(),
  model: z.string().optional(),
  llmMode: z.enum(['legacy', 'delta']).optional(),
  llmDeltaMode: z.string().optional(),
  llmDelta: z.unknown().optional(),
});
type ApplyBody = z.infer<typeof applySchema>;

router.post(
  '/:id/apply',
  requireAuth,
  validate({ params: idParamSchema, body: applySchema }),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const packageId = paramToString((req.params as { id?: string | string[] }).id);
    const { userQuestion, mode, provider, model, llmMode, llmDeltaMode, llmDelta } = req.body as ApplyBody;

    try {
      if (llmDeltaMode !== undefined && llmDeltaMode !== 'best_effort' && llmDeltaMode !== 'strict') {
        sendServiceError(res, 'E_INVALID_INPUT');
        return;
      }

      const applyOptions =
        llmMode === 'delta'
          ? {
              llmMode: 'delta' as const,
              llmDeltaMode: (llmDeltaMode as 'best_effort' | 'strict' | undefined) ?? 'best_effort',
              llmDelta,
            }
          : undefined;

      const result = await svc.applyPackage(
        userId,
        packageId,
        {
          userQuestion,
          mode,
          provider,
          model,
        },
        applyOptions
      );

      if (!result.ok) {
        sendServiceError(res, result.code);
        return;
      }

      res.json({ success: true, data: result.data });
    } catch (err: unknown) {
      sendServiceError(res, extractErrorCode(err));
    }
  })
);

export default router;



