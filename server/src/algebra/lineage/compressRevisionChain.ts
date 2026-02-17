import { composeDelta } from '../deltaCompose/composeDelta';
import { diffState } from '../semanticDiff/diffState';
import type { SemanticDelta } from '../semanticDiff/types';
import { revisionToSemanticState, type RevisionLike } from '../../services/task-package-revision-delta';

type ChainRevision = RevisionLike & {
  id?: string;
  parentRevisionId?: string | null;
};

type LineageErrorCode = 'E_REVISION_PAYLOAD_MISSING' | 'E_REVISION_CHAIN_INVALID';
type LineageError = Error & { code: LineageErrorCode };

const DOMAIN_ORDER = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'] as const;

function makeLineageError(code: LineageErrorCode, message: string): LineageError {
  const error = new Error(message) as LineageError;
  error.code = code;
  return error;
}

function assertPayloads(revisions: ChainRevision[]): void {
  for (const revision of revisions) {
    if (!('payload' in revision) || revision.payload === undefined) {
      throw makeLineageError('E_REVISION_PAYLOAD_MISSING', 'Revision payload is required');
    }
  }
}

function assertLinearAdjacency(revisions: ChainRevision[]): void {
  for (let i = 0; i < revisions.length - 1; i += 1) {
    const current = revisions[i];
    const next = revisions[i + 1];
    if (
      typeof current.id === 'string' &&
      current.id.length > 0 &&
      typeof next.parentRevisionId === 'string' &&
      next.parentRevisionId.length > 0 &&
      next.parentRevisionId !== current.id
    ) {
      throw makeLineageError('E_REVISION_CHAIN_INVALID', 'Revision chain is not linear');
    }
  }
}

function makeIdentityDelta(revisionHash: string): SemanticDelta {
  const domainDelta = { added: [], removed: [], modified: [] };
  const counts: Record<string, number> = {};

  for (const domain of DOMAIN_ORDER) {
    counts[`${domain}.added`] = 0;
    counts[`${domain}.removed`] = 0;
    counts[`${domain}.modified`] = 0;
  }
  counts['collisions.soft'] = 0;
  counts['collisions.hard'] = 0;

  return {
    schemaVersion: 'sdiff-0.1',
    base: { revisionHash },
    target: { revisionHash },
    facts: { ...domainDelta },
    decisions: { ...domainDelta },
    constraints: { ...domainDelta },
    risks: { ...domainDelta },
    assumptions: { ...domainDelta },
    meta: {
      determinism: {
        canonicalVersion: 'tpkg-0.2-canon-v1',
        keyStrategy: 'sig-hash-v1',
        tieBreakers: [],
      },
      collisions: {
        soft: [],
        hard: [],
      },
      counts,
    },
  };
}

function diffAdjacentRevisions(left: ChainRevision, right: ChainRevision): SemanticDelta {
  const leftState = revisionToSemanticState(left);
  const rightState = revisionToSemanticState(right);
  return diffState(leftState, rightState);
}

export function compressRevisionChain(revisions: RevisionLike[]): SemanticDelta {
  if (!Array.isArray(revisions)) {
    throw makeLineageError('E_REVISION_CHAIN_INVALID', 'Revision chain is not linear');
  }

  const ordered = revisions as ChainRevision[];
  assertPayloads(ordered);
  assertLinearAdjacency(ordered);

  if (ordered.length < 2) {
    const singleHash = typeof ordered[0]?.revisionHash === 'string' ? ordered[0].revisionHash : '';
    return makeIdentityDelta(singleHash);
  }

  let composed = diffAdjacentRevisions(ordered[0], ordered[1]);
  for (let i = 1; i < ordered.length - 1; i += 1) {
    const nextDelta = diffAdjacentRevisions(ordered[i], ordered[i + 1]);
    composed = composeDelta(composed, nextDelta);
  }

  return composed;
}

