import type { RevisionLike } from '../../services/task-package-revision-delta';

type IndexedRevision = RevisionLike & {
  id: string;
  parentRevisionId?: string | null;
};

type LcaErrorCode = 'E_REVISION_NOT_FOUND' | 'E_REVISION_CYCLE' | 'E_NO_COMMON_ANCESTOR';
type LcaError = Error & { code: LcaErrorCode };

const ERR_NOT_FOUND_FROM = 'Revision not found: fromId';
const ERR_NOT_FOUND_TO = 'Revision not found: toId';
const ERR_NOT_FOUND_IN_LINEAGE = 'Revision not found in lineage';
const ERR_CYCLE = 'Cycle detected in parentRevisionId chain';
const ERR_NO_COMMON_ANCESTOR = 'No common ancestor between fromId and toId';

function makeLcaError(code: LcaErrorCode, message: string): LcaError {
  const error = new Error(message) as LcaError;
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
    throw makeLcaError('E_REVISION_NOT_FOUND', notFoundMessage);
  }
  return revision;
}

function buildAncestorDepthMap(
  start: IndexedRevision,
  index: Record<string, RevisionLike>
): Map<string, number> {
  const ancestorDepth = new Map<string, number>();
  const visited = new Set<string>();

  let cursor: IndexedRevision | undefined = start;
  let depth = 0;
  while (cursor) {
    if (visited.has(cursor.id)) {
      throw makeLcaError('E_REVISION_CYCLE', ERR_CYCLE);
    }
    visited.add(cursor.id);
    ancestorDepth.set(cursor.id, depth);

    const parentId = cursor.parentRevisionId;
    if (!parentId) break;

    const parent = index[parentId] as IndexedRevision | undefined;
    if (!parent) {
      throw makeLcaError('E_REVISION_NOT_FOUND', ERR_NOT_FOUND_IN_LINEAGE);
    }

    cursor = parent;
    depth += 1;
  }

  return ancestorDepth;
}

export function findLowestCommonAncestor(
  fromId: string,
  toId: string,
  index: Record<string, RevisionLike>
): { lcaId: string; fromDepth: number; toDepth: number } {
  const fromRevision = getIndexedRevision(index, fromId, ERR_NOT_FOUND_FROM);
  const toRevision = getIndexedRevision(index, toId, ERR_NOT_FOUND_TO);

  const fromAncestorDepth = buildAncestorDepthMap(fromRevision, index);
  const visited = new Set<string>();

  let cursor: IndexedRevision | undefined = toRevision;
  let toDepth = 0;
  while (cursor) {
    if (visited.has(cursor.id)) {
      throw makeLcaError('E_REVISION_CYCLE', ERR_CYCLE);
    }
    visited.add(cursor.id);

    const fromDepth = fromAncestorDepth.get(cursor.id);
    if (fromDepth !== undefined) {
      return { lcaId: cursor.id, fromDepth, toDepth };
    }

    const parentId = cursor.parentRevisionId;
    if (!parentId) {
      throw makeLcaError('E_NO_COMMON_ANCESTOR', ERR_NO_COMMON_ANCESTOR);
    }

    const parent = index[parentId] as IndexedRevision | undefined;
    if (!parent) {
      throw makeLcaError('E_REVISION_NOT_FOUND', ERR_NOT_FOUND_IN_LINEAGE);
    }

    cursor = parent;
    toDepth += 1;
  }

  throw makeLcaError('E_NO_COMMON_ANCESTOR', ERR_NO_COMMON_ANCESTOR);
}
