import {
  buildArtifactBundleV1,
  verifyArtifactBundleV1,
  type ArtifactBundleV1,
  type BuildArtifactBundleV1Input,
  type ClosureContractRefV1,
} from './artifact-bundle-v1';
import type { TransferPackageV1 } from './transfer-package-v1';
import type { LineageBindingV1 } from './lineage-binding-v1';
import type { HandoffRecordV1 } from './handoff-record-v1';

export type BuildArtifactBundleV1FromTransferFlowInput = {
  transferPackageV1: TransferPackageV1;
  lineageBindingV1: LineageBindingV1;
  handoffRecordV1: HandoffRecordV1;
  closureContractV1?: ClosureContractRefV1;
  identity?: {
    revisionId?: string | null;
    revisionHash?: string | null;
  };
  createdAt?: string | null;
  notes?: string[];
};

export function buildArtifactBundleV1FromTransferFlow(
  input: BuildArtifactBundleV1FromTransferFlowInput
): ArtifactBundleV1 {
  return buildArtifactBundleV1({
    identity: {
      packageId: input.transferPackageV1.identity.packageId,
      revisionId:
        typeof input.identity?.revisionId === 'string'
          ? input.identity.revisionId
          : input.identity?.revisionId === null
          ? null
          : input.transferPackageV1.identity.revisionId,
      revisionHash:
        typeof input.identity?.revisionHash === 'string'
          ? input.identity.revisionHash
          : input.identity?.revisionHash === null
          ? null
          : input.transferPackageV1.identity.revisionHash,
    },
    artifacts: {
      transferPackageV1: input.transferPackageV1,
      lineageBindingV1: input.lineageBindingV1,
      handoffRecordV1: input.handoffRecordV1,
      closureContractV1: input.closureContractV1 ?? null,
    },
    diagnostics: {
      notes: input.notes ?? [],
    },
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : input.createdAt === null ? null : null,
  });
}

export function verifyArtifactBundleV1ForApi(
  artifactBundleV1: ArtifactBundleV1
): { ok: true; recomputedHash: string; matches: boolean } {
  return verifyArtifactBundleV1(artifactBundleV1);
}

export class ArtifactBundleService {
  buildArtifactBundleV1(
    input: Omit<BuildArtifactBundleV1Input, 'artifacts'> & {
      artifacts: {
        transferPackageV1: unknown;
        lineageBindingV1: unknown;
        handoffRecordV1: unknown;
        closureContractV1?: unknown;
      };
    }
  ): ArtifactBundleV1 {
    return buildArtifactBundleV1({
      identity: input.identity,
      artifacts: {
        transferPackageV1: input.artifacts.transferPackageV1 as TransferPackageV1,
        lineageBindingV1: input.artifacts.lineageBindingV1 as LineageBindingV1,
        handoffRecordV1: input.artifacts.handoffRecordV1 as HandoffRecordV1,
        closureContractV1: (input.artifacts.closureContractV1 as ClosureContractRefV1 | undefined) ?? null,
      },
      diagnostics: input.diagnostics,
      createdAt: input.createdAt,
    });
  }

  verifyArtifactBundleV1(input: { artifactBundleV1: unknown }): { ok: true; recomputedHash: string; matches: boolean } {
    return verifyArtifactBundleV1ForApi(input.artifactBundleV1 as ArtifactBundleV1);
  }
}
