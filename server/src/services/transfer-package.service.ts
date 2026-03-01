import { prisma } from '../utils';
import { TaskPackageService } from './task-package.service';
import {
  buildTransferPackageV1,
  type BuildTransferPackageV1Input,
  type TransferClosureBindingInput,
  type TransferPackageV1,
  recomputeTransferPackageV1Hash,
  verifyTransferPackageV1,
} from './transfer-package-v1';
import {
  buildHandoffRecordV1,
  verifyHandoffRecordV1 as verifyHandoffRecordV1Contract,
  type HandoffRecordV1,
} from './handoff-record-v1';
import {
  buildLineageBindingV1,
  verifyLineageBindingV1 as verifyLineageBindingV1Contract,
  type LineageBindingV1,
} from './lineage-binding-v1';

type TransferOverrides = {
  trunk?: BuildTransferPackageV1Input['trunk'];
  continuation?: BuildTransferPackageV1Input['continuation'];
  conflicts?: BuildTransferPackageV1Input['conflicts'];
};

export type BuildTransferPackageV1FromApplyContextInput = {
  identity: {
    packageId: string;
    revisionId: string;
    revisionHash: string;
    parentRevisionId?: string | null;
  };
  closureContractV1?: TransferClosureBindingInput;
  applyReportV1Hash?: string | null;
  executionRecordV1Hash?: string | null;
  userProvided?: {
    primaryIntent?: string | null;
    successCriteria?: string[];
    nonGoals?: string[];
    stateDigest?: Partial<Record<'facts' | 'decisions' | 'constraints' | 'risks' | 'assumptions' | 'openLoops', string[]>>;
    nextActions?: Array<{
      code: string;
      message: string;
      expectedOutput?: string | null;
      domains?: Array<'facts' | 'decisions' | 'constraints' | 'risks' | 'assumptions'>;
    }>;
    validationChecklist?: Array<{
      code: string;
      message: string;
      severity?: 'must' | 'should';
    }>;
  };
  overrides?: TransferOverrides;
};

export type CreateTransferPackageInput = {
  revisionId?: string;
  include?: {
    closureContractV1?: boolean;
    applyReportV1Hash?: boolean;
    executionRecordV1Hash?: boolean;
  };
  closureContractV1?: TransferClosureBindingInput;
  applyReportV1Hash?: string | null;
  executionRecordV1Hash?: string | null;
  trunk?: BuildTransferPackageV1Input['trunk'];
  continuation?: BuildTransferPackageV1Input['continuation'];
};

export type IngestTransferPackageV1Input = {
  transferPackageV1: TransferPackageV1;
  include?: {
    closureContractV1?: boolean;
    applyReportV1Hash?: boolean;
    executionRecordV1Hash?: boolean;
  };
  bindings?: {
    closureContractV1?: TransferClosureBindingInput;
    applyReportV1Hash?: string | null;
    executionRecordV1Hash?: string | null;
  };
  createdAt?: string | null;
};

export type BuildLineageBindingForTransferFlowV1Input = {
  transferPackageV1: TransferPackageV1;
  include?: {
    closure?: boolean;
    execution?: boolean;
    handoff?: boolean;
  };
  closureContractV1?: TransferClosureBindingInput;
  applyReportV1Hash?: string | null;
  executionRecordV1Hash?: string | null;
  handoffRecordV1?: HandoffRecordV1 | null;
  createdAt?: string | null;
};

function makeError(code: 'NOT_FOUND' | 'NO_REVISION', message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

export function buildTransferPackageV1FromApplyContext(
  input: BuildTransferPackageV1FromApplyContextInput
): TransferPackageV1 {
  return buildTransferPackageV1({
    identity: {
      packageId: input.identity.packageId,
      revisionId: input.identity.revisionId,
      revisionHash: input.identity.revisionHash,
      parentRevisionId: input.identity.parentRevisionId ?? null,
    },
    bindings: {
      closureContractV1: input.closureContractV1 ?? null,
      applyReportV1Hash: input.applyReportV1Hash ?? null,
      executionRecordV1Hash: input.executionRecordV1Hash ?? null,
    },
    trunk: {
      intent: {
        primary: input.userProvided?.primaryIntent ?? null,
        successCriteria: input.userProvided?.successCriteria ?? [],
        nonGoals: input.userProvided?.nonGoals ?? [],
      },
      stateDigest: input.userProvided?.stateDigest ?? input.overrides?.trunk?.stateDigest ?? {},
    },
    continuation: {
      nextActions: input.userProvided?.nextActions ?? input.overrides?.continuation?.nextActions ?? [],
      validationChecklist:
        input.userProvided?.validationChecklist ?? input.overrides?.continuation?.validationChecklist ?? [],
    },
    conflicts: input.overrides?.conflicts ?? [],
  });
}

export function verifyTransferPackageV1OrThrow(transferPackageV1: TransferPackageV1): string {
  return verifyTransferPackageV1(transferPackageV1).recomputedHash;
}

export function getTransferPackageV1VerificationResult(
  transferPackageV1: TransferPackageV1
): { ok: true; recomputedHash: string; matches: boolean } {
  const recomputedHash = recomputeTransferPackageV1Hash(transferPackageV1);
  return {
    ok: true,
    recomputedHash,
    matches: recomputedHash === transferPackageV1.transferHash,
  };
}

export function buildLineageBindingForTransferFlowV1(
  input: BuildLineageBindingForTransferFlowV1Input
): LineageBindingV1 {
  const transferPackageV1 = input.transferPackageV1;
  const includeClosure = input.include?.closure === true;
  const includeExecution = input.include?.execution === true;

  const closureBinding = includeClosure && input.closureContractV1 ? input.closureContractV1 : null;
  const hasExecutionBindingInput =
    typeof input.applyReportV1Hash === 'string' || typeof input.executionRecordV1Hash === 'string';
  const executionBinding =
    includeExecution && hasExecutionBindingInput
      ? {
          schema: 'execution-record-1' as const,
          reportHash: typeof input.applyReportV1Hash === 'string' ? input.applyReportV1Hash : null,
          deltaHash: typeof input.executionRecordV1Hash === 'string' ? input.executionRecordV1Hash : null,
        }
      : null;
  return buildLineageBindingV1({
    identity: {
      packageId: transferPackageV1.identity.packageId,
      revisionId: transferPackageV1.identity.revisionId,
      revisionHash: transferPackageV1.identity.revisionHash,
      parentRevisionId: transferPackageV1.identity.parentRevisionId,
    },
    bindings: {
      transfer: {
        schema: 'transfer-package-1',
        transferHash: transferPackageV1.transferHash,
      },
      closure: closureBinding,
      execution: executionBinding,
      handoff: null,
    },
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : input.createdAt === null ? null : null,
  });
}

export function getLineageBindingV1VerificationResult(
  lineageBindingV1: LineageBindingV1
): { ok: true; recomputedHash: string; matches: boolean } {
  return verifyLineageBindingV1Contract(lineageBindingV1);
}

export function getHandoffRecordV1VerificationResult(
  handoffRecordV1: HandoffRecordV1
): { ok: true; recomputedHash: string; matches: boolean } {
  return verifyHandoffRecordV1Contract(handoffRecordV1);
}

export function ingestTransferPackageV1(input: IngestTransferPackageV1Input): HandoffRecordV1 {
  const recomputedHash = verifyTransferPackageV1OrThrow(input.transferPackageV1);
  const includeClosure = input.include?.closureContractV1 === true;
  const includeApplyReportV1Hash = input.include?.applyReportV1Hash === true;
  const includeExecutionRecordV1Hash = input.include?.executionRecordV1Hash === true;
  const createdAt = typeof input.createdAt === 'string' ? input.createdAt : input.createdAt === null ? null : null;
  const lineageBindingV1 = buildLineageBindingForTransferFlowV1({
    transferPackageV1: input.transferPackageV1,
    include: {
      closure: includeClosure,
      execution: includeApplyReportV1Hash || includeExecutionRecordV1Hash,
      handoff: false,
    },
    closureContractV1: includeClosure ? input.bindings?.closureContractV1 ?? null : null,
    applyReportV1Hash: includeApplyReportV1Hash ? input.bindings?.applyReportV1Hash ?? null : null,
    executionRecordV1Hash: includeExecutionRecordV1Hash ? input.bindings?.executionRecordV1Hash ?? null : null,
    createdAt,
  });

  return buildHandoffRecordV1({
    transferPackageV1: input.transferPackageV1,
    verification: {
      transferHashRecomputed: recomputedHash,
      matchesProvidedHash: true,
    },
    bindings: {
      closureContractV1: includeClosure ? input.bindings?.closureContractV1 ?? null : null,
      applyReportV1Hash: includeApplyReportV1Hash ? input.bindings?.applyReportV1Hash ?? null : null,
      executionRecordV1Hash: includeExecutionRecordV1Hash ? input.bindings?.executionRecordV1Hash ?? null : null,
    },
    lineageBindingV1,
    createdAt,
  });
}

export class TransferPackageService {
  private readonly taskPackageService = new TaskPackageService();

  verifyTransferPackageV1(input: { transferPackageV1: unknown }): { ok: true; recomputedHash: string; matches: boolean } {
    return getTransferPackageV1VerificationResult(input.transferPackageV1 as TransferPackageV1);
  }

  verifyLineageBindingV1(input: { lineageBindingV1: unknown }): { ok: true; recomputedHash: string; matches: boolean } {
    return getLineageBindingV1VerificationResult(input.lineageBindingV1 as LineageBindingV1);
  }

  verifyHandoffRecordV1(input: { handoffRecordV1: unknown }): { ok: true; recomputedHash: string; matches: boolean } {
    return getHandoffRecordV1VerificationResult(input.handoffRecordV1 as HandoffRecordV1);
  }

  buildLineageBindingForTransferFlowV1(
    input: Omit<BuildLineageBindingForTransferFlowV1Input, 'transferPackageV1'> & { transferPackageV1: unknown }
  ): LineageBindingV1 {
    return buildLineageBindingForTransferFlowV1({
      ...input,
      transferPackageV1: input.transferPackageV1 as TransferPackageV1,
    });
  }

  ingestTransferPackageV1(
    input: Omit<IngestTransferPackageV1Input, 'transferPackageV1'> & { transferPackageV1: unknown }
  ): HandoffRecordV1 {
    return ingestTransferPackageV1({
      ...input,
      transferPackageV1: input.transferPackageV1 as TransferPackageV1,
    });
  }

  async createTransferPackage(
    userId: string,
    packageId: string,
    input: CreateTransferPackageInput
  ): Promise<TransferPackageV1> {
    const pkg = await this.taskPackageService.getOwned(userId, packageId);

    let revision:
      | {
          id: string;
          revisionHash: string;
          parentRevisionId: string | null;
        }
      | null = null;

    if (typeof input.revisionId === 'string') {
      if (pkg.currentRevision && pkg.currentRevision.id === input.revisionId) {
        revision = {
          id: pkg.currentRevision.id,
          revisionHash: String(pkg.currentRevision.revisionHash),
          parentRevisionId:
            typeof pkg.currentRevision.parentRevisionId === 'string'
              ? pkg.currentRevision.parentRevisionId
              : pkg.currentRevision.parentRevisionId === null
              ? null
              : null,
        };
      } else {
        const found = await prisma.taskPackageRevision.findUnique({
          where: { id: input.revisionId },
          select: {
            id: true,
            packageId: true,
            revisionHash: true,
            parentRevisionId: true,
          },
        });

        if (!found || found.packageId !== packageId) {
          throw makeError('NOT_FOUND', 'NOT_FOUND');
        }

        revision = {
          id: found.id,
          revisionHash: found.revisionHash,
          parentRevisionId: found.parentRevisionId,
        };
      }
    } else if (pkg.currentRevision) {
      revision = {
        id: pkg.currentRevision.id,
        revisionHash: String(pkg.currentRevision.revisionHash),
        parentRevisionId:
          typeof pkg.currentRevision.parentRevisionId === 'string'
            ? pkg.currentRevision.parentRevisionId
            : pkg.currentRevision.parentRevisionId === null
            ? null
            : null,
      };
    }

    if (!revision) {
      throw makeError('NO_REVISION', 'NO_REVISION');
    }

    const includeClosure = input.include?.closureContractV1 === true;
    const includeApplyReportV1Hash = input.include?.applyReportV1Hash === true;
    const includeExecutionRecordV1Hash = input.include?.executionRecordV1Hash === true;

    return buildTransferPackageV1FromApplyContext({
      identity: {
        packageId,
        revisionId: revision.id,
        revisionHash: revision.revisionHash,
        parentRevisionId: revision.parentRevisionId,
      },
      closureContractV1: includeClosure && input.closureContractV1 ? input.closureContractV1 : null,
      applyReportV1Hash:
        includeApplyReportV1Hash && typeof input.applyReportV1Hash === 'string' ? input.applyReportV1Hash : null,
      executionRecordV1Hash:
        includeExecutionRecordV1Hash && typeof input.executionRecordV1Hash === 'string'
          ? input.executionRecordV1Hash
          : null,
      userProvided: {
        primaryIntent: input.trunk?.intent?.primary ?? null,
        successCriteria: input.trunk?.intent?.successCriteria ?? [],
        nonGoals: input.trunk?.intent?.nonGoals ?? [],
        stateDigest: input.trunk?.stateDigest ?? {},
        nextActions: input.continuation?.nextActions ?? [],
        validationChecklist: input.continuation?.validationChecklist ?? [],
      },
    });
  }
}
