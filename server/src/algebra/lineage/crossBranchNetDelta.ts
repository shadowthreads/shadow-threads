import { diffState } from '../semanticDiff/diffState';
import type { SemanticDelta } from '../semanticDiff/types';
import { buildAncestorPath, computeNetDeltaBetweenRevisions } from './netDelta';
import { findLowestCommonAncestor } from './lca';
import { revisionToSemanticState, type RevisionLike } from '../../services/task-package-revision-delta';

type IndexedRevision = RevisionLike & {
  id: string;
  parentRevisionId?: string | null;
};

type CrossBranchErrorCode = 'E_REVISION_NOT_FOUND' | 'E_REVISION_PAYLOAD_MISSING';
type CrossBranchError = Error & { code: CrossBranchErrorCode };

const ERR_NOT_FOUND_FROM = 'Revision not found: fromId';
const ERR_NOT_FOUND_TO = 'Revision not found: toId';
const ERR_PAYLOAD_REQUIRED = 'Revision payload is required';

function makeCrossBranchError(code: CrossBranchErrorCode, message: string): CrossBranchError {
  const error = new Error(message) as CrossBranchError;
  error.code = code;
  return error;
}

function getIndexedRevision(
  index: Record<string, RevisionLike>,
  revisionId: string,
  notFoundMessage: string
): IndexedRevision {
  const revision = index[revisionId] as IndexedRevision | undefined;
  if (!revision) {
    throw makeCrossBranchError('E_REVISION_NOT_FOUND', notFoundMessage);
  }
  return revision;
}

function ensureHasPayload(revision: IndexedRevision): void {
  if (!('payload' in revision) || revision.payload === undefined) {
    throw makeCrossBranchError('E_REVISION_PAYLOAD_MISSING', ERR_PAYLOAD_REQUIRED);
  }
}

function computeEndpointDelta(fromRevision: IndexedRevision, toRevision: IndexedRevision): SemanticDelta {
  ensureHasPayload(fromRevision);
  ensureHasPayload(toRevision);
  const fromState = revisionToSemanticState(fromRevision);
  const toState = revisionToSemanticState(toRevision);
  return diffState(fromState, toState);
}

export function computeCrossBranchNetDelta(
  fromId: string,
  toId: string,
  index: Record<string, RevisionLike>
): {
  mode: 'ancestor_path' | 'lca';
  lcaId: string;
  deltaFromLcaToFrom: SemanticDelta;
  deltaFromLcaToTo: SemanticDelta;
  deltaFromTo: SemanticDelta;
} {
  const fromRevision = getIndexedRevision(index, fromId, ERR_NOT_FOUND_FROM);
  const toRevision = getIndexedRevision(index, toId, ERR_NOT_FOUND_TO);

  try {
    buildAncestorPath(fromId, toId, index);
    const identity = computeNetDeltaBetweenRevisions(fromId, fromId, index);
    const net = computeNetDeltaBetweenRevisions(fromId, toId, index);
    return {
      mode: 'ancestor_path',
      lcaId: fromId,
      deltaFromLcaToFrom: identity,
      deltaFromLcaToTo: net,
      deltaFromTo: net,
    };
  } catch (error) {
    if ((error as { code?: string }).code !== 'E_NO_PATH') {
      throw error;
    }
  }

  const { lcaId } = findLowestCommonAncestor(fromId, toId, index);
  const deltaFromLcaToFrom = computeNetDeltaBetweenRevisions(lcaId, fromId, index);
  const deltaFromLcaToTo = computeNetDeltaBetweenRevisions(lcaId, toId, index);
  const deltaFromTo = computeEndpointDelta(fromRevision, toRevision);

  return {
    mode: 'lca',
    lcaId,
    deltaFromLcaToFrom,
    deltaFromLcaToTo,
    deltaFromTo,
  };
}
