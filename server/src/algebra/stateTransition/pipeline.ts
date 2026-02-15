import { detectConflicts } from './detectConflicts';
import { applyDelta } from './applyDelta';
import type { TransitionConflict, TransitionFinding, TransitionMode, TransitionResult } from './types';
import type { DomainName, SemanticDelta } from '../semanticDiff/types';
import {
  computeRevisionDelta,
  revisionToSemanticState,
  summarizeDelta,
  type RevisionLike,
} from '../../services/task-package-revision-delta';

type DeltaSummary = ReturnType<typeof summarizeDelta>;

export type ComputeNextStateOptions = {
  transitionMode?: TransitionMode;
  failOnConflicts?: boolean;
};

export type NextStateFromRevisionsResult = {
  delta: SemanticDelta;
  deltaSummary: DeltaSummary;
  transition: TransitionResult;
};

type PipelineErrorCode = 'E_CONFLICTS_PRESENT';

type PipelineError = Error & {
  code: PipelineErrorCode;
  conflictCount: number;
  domains: DomainName[];
};

const DOMAIN_ORDER: DomainName[] = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];
const DOMAIN_RANK = new Map<DomainName, number>(DOMAIN_ORDER.map((domain, index) => [domain, index]));

function makePipelineError(conflicts: TransitionConflict[]): PipelineError {
  const domains = DOMAIN_ORDER.filter((domain) => conflicts.some((conflict) => conflict.domain === domain));
  const error = new Error('Conflicts present after transition') as PipelineError;
  error.code = 'E_CONFLICTS_PRESENT';
  error.conflictCount = conflicts.length;
  error.domains = domains;
  return error;
}

function conflictSort(a: TransitionConflict, b: TransitionConflict): number {
  return (
    (DOMAIN_RANK.get(a.domain) ?? 0) - (DOMAIN_RANK.get(b.domain) ?? 0) ||
    a.code.localeCompare(b.code) ||
    (a.key ?? '').localeCompare(b.key ?? '') ||
    (a.path ?? '').localeCompare(b.path ?? '') ||
    a.message.localeCompare(b.message)
  );
}

function buildPostApplyFinding(conflicts: TransitionConflict[]): TransitionFinding | null {
  if (conflicts.length === 0) return null;
  const domains = DOMAIN_ORDER.filter((domain) => conflicts.some((conflict) => conflict.domain === domain));
  return {
    code: 'POST_APPLY_CONFLICTS',
    count: conflicts.length,
    domains,
  };
}

function appendFinding(findings: TransitionFinding[], finding: TransitionFinding | null): TransitionFinding[] {
  if (!finding) return [...findings];
  return [...findings, finding];
}

export function computeNextStateFromRevisions(
  baseRev: RevisionLike,
  targetRev: RevisionLike,
  opts?: ComputeNextStateOptions
): NextStateFromRevisionsResult {
  const delta = computeRevisionDelta(baseRev, targetRev);
  const deltaSummary = summarizeDelta(delta);
  const normalizedBaseState = revisionToSemanticState(baseRev);
  const transitionMode = opts?.transitionMode ?? 'best_effort';

  const transitionBase = applyDelta(normalizedBaseState, delta, { mode: transitionMode });
  const postApplyConflicts = detectConflicts(transitionBase.nextState).sort(conflictSort);
  const transition: TransitionResult = {
    ...transitionBase,
    conflicts: [...transitionBase.conflicts].sort(conflictSort),
    findings: appendFinding(transitionBase.findings, buildPostApplyFinding(postApplyConflicts)),
  };

  if (opts?.failOnConflicts === true && transition.conflicts.length > 0) {
    throw makePipelineError(transition.conflicts);
  }

  return {
    delta,
    deltaSummary,
    transition,
  };
}
