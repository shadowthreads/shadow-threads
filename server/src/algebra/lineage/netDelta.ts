import type { SemanticDelta } from '../semanticDiff/types';
import { compressRevisionChain } from './compressRevisionChain';
import type { RevisionLike } from '../../services/task-package-revision-delta';

type IndexedRevision = RevisionLike & {
  id: string;
  parentRevisionId?: string | null;
};

type LineageErrorCode =
  | 'E_REVISION_NOT_FOUND'
  | 'E_REVISION_PAYLOAD_MISSING'
  | 'E_NO_PATH'
  | 'E_REVISION_CYCLE';

type LineageError = Error & { code: LineageErrorCode };

const ERR_NOT_FOUND_FROM = 'Revision not found: fromId';
const ERR_NOT_FOUND_TO = 'Revision not found: toId';
const ERR_NOT_FOUND_IN_LINEAGE = 'Revision not found in lineage';
const ERR_PAYLOAD_REQUIRED = 'Revision payload is required';
const ERR_NO_PATH = 'No ancestor path from fromId to toId';
const ERR_CYCLE = 'Cycle detected in parentRevisionId chain';

function makeLineageError(code: LineageErrorCode, message: string): LineageError {
  const error = new Error(message) as LineageError;
  error.code = code;
  return error;
}

function throwCycle(): never {
  throw makeLineageError('E_REVISION_CYCLE', ERR_CYCLE);
}

function assertAcyclicFromRevision(
  start: IndexedRevision,
  index: Record<string, RevisionLike>
): void {
  const visited = new Set<string>();
  let cursor: IndexedRevision | undefined = start;

  while (cursor) {
    if (visited.has(cursor.id)) {
      throwCycle();
    }
    visited.add(cursor.id);

    const parentId = cursor.parentRevisionId;
    if (!parentId) {
      return;
    }

    const parentRevision = index[parentId] as IndexedRevision | undefined;
    if (!parentRevision) {
      throw makeLineageError('E_REVISION_NOT_FOUND', ERR_NOT_FOUND_IN_LINEAGE);
    }

    cursor = parentRevision;
  }
}

function ensureHasPayload(revision: IndexedRevision): void {
  if (!('payload' in revision) || revision.payload === undefined) {
    throw makeLineageError('E_REVISION_PAYLOAD_MISSING', ERR_PAYLOAD_REQUIRED);
  }
}

function getIndexedRevision(
  index: Record<string, RevisionLike>,
  revisionId: string,
  notFoundMessage: string
): IndexedRevision {
  const revision = index[revisionId] as IndexedRevision | undefined;
  if (!revision) {
    throw makeLineageError('E_REVISION_NOT_FOUND', notFoundMessage);
  }
  return revision;
}

export function buildAncestorPath(
  fromId: string,
  toId: string,
  index: Record<string, RevisionLike>
): RevisionLike[] {
  const fromRevision = getIndexedRevision(index, fromId, ERR_NOT_FOUND_FROM);
  const toRevision = getIndexedRevision(index, toId, ERR_NOT_FOUND_TO);
  assertAcyclicFromRevision(fromRevision, index);

  if (fromId === toId) {
    ensureHasPayload(fromRevision);
    return [fromRevision];
  }

  const visited = new Set<string>();
  const reversedPath: IndexedRevision[] = [];
  let cursor: IndexedRevision | undefined = toRevision;

  while (cursor) {
    if (visited.has(cursor.id)) {
      throwCycle();
    }
    visited.add(cursor.id);
    reversedPath.push(cursor);

    if (cursor.id === fromId) {
      const chain = [...reversedPath].reverse();
      for (const revision of chain) {
        ensureHasPayload(revision);
      }
      return chain;
    }

    const parentId = cursor.parentRevisionId;
    if (!parentId) {
      throw makeLineageError('E_NO_PATH', ERR_NO_PATH);
    }

    const parentRevision = index[parentId] as IndexedRevision | undefined;
    if (!parentRevision) {
      throw makeLineageError('E_REVISION_NOT_FOUND', ERR_NOT_FOUND_IN_LINEAGE);
    }
    cursor = parentRevision;
  }

  throw makeLineageError('E_NO_PATH', ERR_NO_PATH);
}

export function computeNetDeltaBetweenRevisions(
  fromId: string,
  toId: string,
  index: Record<string, RevisionLike>
): SemanticDelta {
  const chain = buildAncestorPath(fromId, toId, index);
  return compressRevisionChain(chain);
}
