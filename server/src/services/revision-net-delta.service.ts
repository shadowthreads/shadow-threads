import type { SemanticDelta } from '../algebra/semanticDiff/types';
import { computeCrossBranchNetDelta } from '../algebra';
import { prisma } from '../utils/db';

type Params = {
  taskPackageId: string;
  fromRevisionId: string;
  toRevisionId: string;
};

type RevisionNetDeltaError = Error & {
  code: 'E_REVISION_NOT_FOUND';
};

function makeRevisionNetDeltaError(message: 'Revision not found: fromId' | 'Revision not found: toId'): RevisionNetDeltaError {
  const error = new Error(message) as RevisionNetDeltaError;
  error.code = 'E_REVISION_NOT_FOUND';
  return error;
}

export async function computeRevisionNetDelta(params: Params): Promise<SemanticDelta> {
  const { taskPackageId, fromRevisionId, toRevisionId } = params;

  const revisions = await prisma.taskPackageRevision.findMany({
    where: { packageId: taskPackageId },
    select: {
      id: true,
      parentRevisionId: true,
      payload: true,
      revisionHash: true,
      schemaVersion: true,
    },
  });

  const index: Record<string, (typeof revisions)[number]> = Object.create(null);
  for (const revision of revisions) {
    index[revision.id] = revision;
  }

  if (!index[fromRevisionId]) {
    throw makeRevisionNetDeltaError('Revision not found: fromId');
  }
  if (!index[toRevisionId]) {
    throw makeRevisionNetDeltaError('Revision not found: toId');
  }

  const result = computeCrossBranchNetDelta(fromRevisionId, toRevisionId, index);
  return result.deltaFromTo;
}
