import { prisma } from '../utils';
import { TaskPackageService } from './task-package.service';
import {
  buildTransferPackageV1,
  type BuildTransferPackageV1Input,
  type TransferClosureBindingInput,
  type TransferPackageV1,
} from './transfer-package-v1';

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

export class TransferPackageService {
  private readonly taskPackageService = new TaskPackageService();

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
