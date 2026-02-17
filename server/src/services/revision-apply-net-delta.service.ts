import { applyDelta } from '../algebra/stateTransition/applyDelta';
import type { TransitionMode, TransitionResult } from '../algebra/stateTransition/types';
import { stableHash } from '../algebra/semanticDiff/key';
import type { SemanticDelta } from '../algebra/semanticDiff/types';
import { computeCrossBranchNetDelta } from '../algebra';
import { prisma } from '../utils/db';
import { revisionToSemanticState, summarizeDelta, type RevisionLike } from './task-package-revision-delta';

type ApplyRevisionNetDeltaInput = {
  taskPackageId: string;
  fromRevisionId: string;
  toRevisionId: string;
  mode?: TransitionMode;
};

type IndexedRevision = RevisionLike & {
  id: string;
  parentRevisionId?: string | null;
};

type ServiceErrorCode = 'E_REVISION_NOT_FOUND' | 'E_REVISION_NET_DELTA_CONFLICT';
type ServiceError = Error & { code: ServiceErrorCode };

function makeServiceError(code: ServiceErrorCode, message: string): ServiceError {
  const error = new Error(message) as ServiceError;
  error.code = code;
  return error;
}

function getRevision(index: Record<string, IndexedRevision>, revisionId: string, notFoundMessage: string): IndexedRevision {
  const revision = index[revisionId];
  if (!revision) {
    throw makeServiceError('E_REVISION_NOT_FOUND', notFoundMessage);
  }
  return revision;
}

export async function applyRevisionNetDelta(input: ApplyRevisionNetDeltaInput): Promise<{
  delta: SemanticDelta;
  deltaSummary: ReturnType<typeof summarizeDelta>;
  stateHashBefore: string;
  stateHashAfter: string;
  transition: TransitionResult;
}> {
  const mode: TransitionMode = input.mode ?? 'best_effort';

  const revisions = await prisma.taskPackageRevision.findMany({
    where: { packageId: input.taskPackageId },
    select: {
      id: true,
      parentRevisionId: true,
      payload: true,
      revisionHash: true,
      schemaVersion: true,
    },
  });

  const index: Record<string, IndexedRevision> = Object.create(null);
  for (const revision of revisions) {
    index[revision.id] = revision;
  }

  const fromRevision = getRevision(index, input.fromRevisionId, 'Revision not found: fromId');
  const toRevision = getRevision(index, input.toRevisionId, 'Revision not found: toId');

  const fromState = revisionToSemanticState(fromRevision);
  const toState = revisionToSemanticState(toRevision);
  const crossBranch = computeCrossBranchNetDelta(input.fromRevisionId, input.toRevisionId, index);
  const delta = crossBranch.deltaFromTo;
  const deltaSummary = summarizeDelta(delta);
  const transitionBase = applyDelta(fromState, delta, { mode });
  const transition: TransitionResult =
    transitionBase.conflicts.length === 0
      ? { ...transitionBase, nextState: toState }
      : transitionBase;

  if (mode === 'strict' && transition.conflicts.length > 0) {
    throw makeServiceError('E_REVISION_NET_DELTA_CONFLICT', 'Revision net delta contains conflicts');
  }

  return {
    delta,
    deltaSummary,
    stateHashBefore: stableHash(fromState),
    stateHashAfter: stableHash(transition.nextState),
    transition,
  };
}
