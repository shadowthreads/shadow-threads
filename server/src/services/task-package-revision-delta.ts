import { diffState } from '../algebra/semanticDiff/diffState';
import type { SemanticDelta } from '../algebra/semanticDiff/types';
import { stableHash } from '../algebra/semanticDiff/key';
import { normalizeTaskPackagePayload } from './task-package.normalize';

export type RevisionLike = {
  payload?: unknown;
  schemaVersion?: string;
  revisionHash?: string;
};

type RevisionDeltaErrorCode =
  | 'E_PAYLOAD_MISSING'
  | 'E_PAYLOAD_INVALID'
  | 'E_NORMALIZE_FAILED'
  | 'E_DIFF_FAILED';

type RevisionDeltaError = Error & { code: RevisionDeltaErrorCode };

type DomainSummary = {
  added: number;
  removed: number;
  modified: number;
};

type DeltaSummary = {
  counts: {
    facts: DomainSummary;
    decisions: DomainSummary;
    constraints: DomainSummary;
    risks: DomainSummary;
    assumptions: DomainSummary;
  };
  hasCollisions: boolean;
  assumptionsDerived: boolean;
  modifiedDomains: Array<'facts' | 'decisions' | 'constraints' | 'risks' | 'assumptions'>;
};

const DOMAIN_ORDER = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'] as const;

function makeRevisionDeltaError(code: RevisionDeltaErrorCode, message: string): RevisionDeltaError {
  const error = new Error(message) as RevisionDeltaError;
  error.code = code;
  return error;
}

function assertPayload(revision: RevisionLike, label: 'revA' | 'revB'): unknown {
  if (!('payload' in revision) || revision.payload === undefined) {
    throw makeRevisionDeltaError('E_PAYLOAD_MISSING', `${label}.payload is required`);
  }
  return revision.payload;
}

function assertJsonSafe(payload: unknown, label: 'revA' | 'revB'): void {
  try {
    // Reuse canonicalization behavior from semanticDiff key utilities.
    // We only trigger validation side effects; hash output is intentionally ignored.
    stableHash(payload);
  } catch {
    throw makeRevisionDeltaError('E_PAYLOAD_INVALID', `${label}.payload must be JSON-safe`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function flattenConstraints(input: {
  technical: string[];
  process: string[];
  policy: string[];
}): Array<{ scope: 'technical' | 'process' | 'policy'; rule: string }> {
  const out: Array<{ scope: 'technical' | 'process' | 'policy'; rule: string }> = [];
  for (const scope of ['technical', 'process', 'policy'] as const) {
    for (const rule of input[scope]) {
      out.push({ scope, rule });
    }
  }
  return out;
}

function pickRevisionHash(revision: RevisionLike): string {
  if (typeof revision.revisionHash === 'string') return revision.revisionHash;

  if (revision.payload === undefined) return '';
  const payload = asRecord(revision.payload);
  if (typeof payload.revisionHash === 'string') return payload.revisionHash;

  const manifest = asRecord(payload.manifest);
  return typeof manifest.revisionHash === 'string' ? manifest.revisionHash : '';
}

export function revisionToSemanticState(revision: RevisionLike): unknown {
  const payloadInput = revision.payload;
  const payload = asRecord(revision.payload);
  let normalized: ReturnType<typeof normalizeTaskPackagePayload>['normalized'];
  try {
    normalized = normalizeTaskPackagePayload(payloadInput, {
      revision: 0,
      sourceSnapshotId: null,
    }).normalized;
  } catch {
    throw makeRevisionDeltaError('E_NORMALIZE_FAILED', 'normalizeTaskPackagePayload failed');
  }

  const topFacts = asArray(payload.facts);
  const topDecisions = asArray(payload.decisions);
  const topRisks = asArray(payload.risks);
  const topAssumptions = asArray(payload.assumptions);
  const topConstraints = asArray(payload.constraints);

  return {
    ...normalized,
    revisionHash: pickRevisionHash(revision),
    facts: topFacts ?? [...normalized.state.facts],
    decisions: topDecisions ?? [...normalized.state.decisions],
    constraints: topConstraints ?? flattenConstraints(normalized.constraints),
    risks: topRisks ?? [...normalized.risks],
    assumptions: topAssumptions ?? [...normalized.state.assumptions],
  };
}

export function computeRevisionDelta(revA: RevisionLike, revB: RevisionLike): SemanticDelta {
  const payloadA = assertPayload(revA, 'revA');
  const payloadB = assertPayload(revB, 'revB');
  assertJsonSafe(payloadA, 'revA');
  assertJsonSafe(payloadB, 'revB');

  const normalizedA = revisionToSemanticState({ ...revA, payload: payloadA });
  const normalizedB = revisionToSemanticState({ ...revB, payload: payloadB });

  try {
    return diffState(normalizedA, normalizedB);
  } catch {
    throw makeRevisionDeltaError('E_DIFF_FAILED', 'diffState failed');
  }
}

export function summarizeDelta(delta: SemanticDelta): DeltaSummary {
  const counts = {
    facts: {
      added: delta.facts.added.length,
      removed: delta.facts.removed.length,
      modified: delta.facts.modified.length,
    },
    decisions: {
      added: delta.decisions.added.length,
      removed: delta.decisions.removed.length,
      modified: delta.decisions.modified.length,
    },
    constraints: {
      added: delta.constraints.added.length,
      removed: delta.constraints.removed.length,
      modified: delta.constraints.modified.length,
    },
    risks: {
      added: delta.risks.added.length,
      removed: delta.risks.removed.length,
      modified: delta.risks.modified.length,
    },
    assumptions: {
      added: delta.assumptions.added.length,
      removed: delta.assumptions.removed.length,
      modified: delta.assumptions.modified.length,
    },
  };

  const modifiedDomains = DOMAIN_ORDER.filter((domain) => {
    const c = counts[domain];
    return c.added + c.removed + c.modified > 0;
  });

  return {
    counts,
    hasCollisions: delta.meta.collisions.soft.length > 0 || delta.meta.collisions.hard.length > 0,
    assumptionsDerived: delta.meta.assumptionsDerived === true,
    modifiedDomains,
  };
}
