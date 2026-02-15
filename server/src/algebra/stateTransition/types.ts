import type { DomainName } from '../semanticDiff/types';

export type TransitionMode = 'strict' | 'best_effort';

export type TransitionConflict = {
  code: string;
  domain: DomainName;
  key?: string;
  path?: string;
  message: string;
};

export type TransitionFinding = {
  code: string;
  message?: string;
  count?: number;
  domains?: DomainName[];
};

export type DomainCounts = {
  added: number;
  removed: number;
  modified: number;
};

export type TransitionPerDomainCounts = Record<DomainName, DomainCounts>;

export type TransitionResult<TpkgV02 = unknown> = {
  nextState: TpkgV02;
  applied: { perDomain: TransitionPerDomainCounts };
  rejected: { perDomain: TransitionPerDomainCounts };
  conflicts: TransitionConflict[];
  findings: TransitionFinding[];
};
