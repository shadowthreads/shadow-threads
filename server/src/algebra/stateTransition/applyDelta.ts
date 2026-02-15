import { canonicalizeDeep, computeUnitKey, stableHash } from '../semanticDiff/key';
import type { DomainDelta, DomainName, FieldChange, SemanticDelta } from '../semanticDiff/types';
import { detectConflicts } from './detectConflicts';
import type {
  DomainCounts,
  TransitionConflict,
  TransitionFinding,
  TransitionMode,
  TransitionPerDomainCounts,
  TransitionResult,
} from './types';

const DOMAIN_ORDER: DomainName[] = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];
const DOMAIN_RANK = new Map<DomainName, number>(DOMAIN_ORDER.map((domain, index) => [domain, index]));

type DomainLocation = 'top' | 'state';

function zeroCounts(): DomainCounts {
  return { added: 0, removed: 0, modified: 0 };
}

function zeroPerDomainCounts(): TransitionPerDomainCounts {
  return {
    facts: zeroCounts(),
    decisions: zeroCounts(),
    constraints: zeroCounts(),
    risks: zeroCounts(),
    assumptions: zeroCounts(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(canonicalizeDeep(value))) as T;
}

function getDomainLocation(state: Record<string, unknown>, domain: DomainName): DomainLocation {
  if (Array.isArray(state[domain])) return 'top';
  if (Array.isArray(asRecord(state.state)[domain])) return 'state';
  return 'top';
}

function readDomainUnits(state: Record<string, unknown>, domain: DomainName, location: DomainLocation): unknown[] {
  if (location === 'top') return asArray(state[domain]);
  return asArray(asRecord(state.state)[domain]);
}

function writeDomainUnits(
  state: Record<string, unknown>,
  domain: DomainName,
  location: DomainLocation,
  units: unknown[]
): void {
  if (location === 'top') {
    state[domain] = units;
    return;
  }

  const stateNode = asRecord(state.state);
  stateNode[domain] = units;
  state.state = stateNode;
}

function buildIndex(domain: DomainName, units: unknown[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let index = 0; index < units.length; index += 1) {
    out.set(computeUnitKey(domain, units[index]), index);
  }
  return out;
}

function rebuildIndex(domain: DomainName, units: unknown[]): Map<string, number> {
  return buildIndex(domain, units);
}

function getContainerForPath(root: Record<string, unknown>, path: string): { container: Record<string, unknown>; key: string } {
  const segments = path.split('.');
  const key = segments.pop() as string;
  let cursor = root;

  for (const segment of segments) {
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }

  return { container: cursor, key };
}

function applyFieldChanges(unit: unknown, changes: FieldChange[]): unknown {
  const nextUnit = asRecord(cloneValue(unit));

  for (const change of changes) {
    const { container, key } = getContainerForPath(nextUnit, change.path);
    if (change.op === 'set') {
      if (change.after !== undefined) {
        container[key] = cloneValue(change.after);
      } else if (change.value !== undefined) {
        container[key] = cloneValue(change.value);
      } else {
        delete container[key];
      }
      continue;
    }

    if (change.op === 'unset') {
      delete container[key];
      continue;
    }

    const arr = asArray(container[key]);

    if (change.op === 'append') {
      if (change.value !== undefined) {
        arr.push(cloneValue(change.value));
      }
      container[key] = arr;
      continue;
    }

    if (change.op === 'remove' && change.value !== undefined) {
      const removeHash = stableHash(change.value);
      const removeIndex = arr.findIndex((item) => stableHash(item) === removeHash);
      if (removeIndex >= 0) arr.splice(removeIndex, 1);
      container[key] = arr;
    }
  }

  return nextUnit;
}

function conflict(domain: DomainName, code: string, message: string, key?: string, path?: string): TransitionConflict {
  return { code, domain, key, path, message };
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

type DomainAttempt = {
  added: Array<{ key: string; unit: unknown }>;
  removed: Array<{ key: string; unit: unknown }>;
  modified: Array<{ key: string; before: unknown; after: unknown; changes: FieldChange[] }>;
};

function prepareDomainAttempt(domain: DomainName, delta: DomainDelta<unknown>): DomainAttempt {
  const sortedByKey = <T extends { key: string }>(items: T[]) =>
    [...items].sort((a, b) => a.key.localeCompare(b.key));

  return {
    added: sortedByKey(
      delta.added.map((item) => ({
        key: item.key || computeUnitKey(domain, item.unit),
        unit: item.unit,
      }))
    ),
    removed: sortedByKey(
      delta.removed.map((item) => ({
        key: item.key || computeUnitKey(domain, item.unit),
        unit: item.unit,
      }))
    ),
    modified: sortedByKey(
      delta.modified.map((item) => ({
        key: item.key || computeUnitKey(domain, item.before),
        before: item.before,
        after: item.after,
        changes: item.changes,
      }))
    ),
  };
}

type DomainApplyResult = {
  nextUnits: unknown[];
  applied: DomainCounts;
  rejected: DomainCounts;
  conflicts: TransitionConflict[];
  attempted: DomainCounts;
};

function applyDomainBestEffort(domain: DomainName, currentUnits: unknown[], delta: DomainDelta<unknown>): DomainApplyResult {
  const attempt = prepareDomainAttempt(domain, delta);
  const attempted: DomainCounts = {
    added: attempt.added.length,
    removed: attempt.removed.length,
    modified: attempt.modified.length,
  };

  const nextUnits = cloneValue(currentUnits);
  let index = buildIndex(domain, nextUnits);
  const applied = zeroCounts();
  const rejected = zeroCounts();
  const conflicts: TransitionConflict[] = [];

  for (const item of attempt.added) {
    if (index.has(item.key)) {
      conflicts.push(conflict(domain, 'E_ADD_EXISTS', 'Add target already exists', item.key));
      rejected.added += 1;
      continue;
    }
    nextUnits.push(cloneValue(item.unit));
    index = rebuildIndex(domain, nextUnits);
    applied.added += 1;
  }

  for (const item of attempt.removed) {
    const at = index.get(item.key);
    if (at === undefined) {
      conflicts.push(conflict(domain, 'E_REMOVE_MISSING', 'Remove target does not exist', item.key));
      rejected.removed += 1;
      continue;
    }
    nextUnits.splice(at, 1);
    index = rebuildIndex(domain, nextUnits);
    applied.removed += 1;
  }

  for (const item of attempt.modified) {
    const at = index.get(item.key);
    if (at === undefined) {
      conflicts.push(conflict(domain, 'E_MODIFY_MISSING', 'Modify target does not exist', item.key));
      rejected.modified += 1;
      continue;
    }

    const updatedUnit = applyFieldChanges(nextUnits[at], item.changes);
    const updatedKey = computeUnitKey(domain, updatedUnit);
    const collisionAt = index.get(updatedKey);
    if (collisionAt !== undefined && collisionAt !== at) {
      conflicts.push(conflict(domain, 'E_MODIFY_KEY_COLLISION', 'Modify would create duplicate key', item.key));
      rejected.modified += 1;
      continue;
    }

    nextUnits[at] = updatedUnit;
    index = rebuildIndex(domain, nextUnits);
    applied.modified += 1;
  }

  return {
    nextUnits,
    applied,
    rejected,
    conflicts: conflicts.sort(conflictSort),
    attempted,
  };
}

function applyDomain(
  domain: DomainName,
  currentUnits: unknown[],
  delta: DomainDelta<unknown>,
  mode: TransitionMode
): DomainApplyResult {
  const trial = applyDomainBestEffort(domain, currentUnits, delta);
  if (mode !== 'strict') return trial;

  if (trial.conflicts.length === 0) {
    return {
      ...trial,
      rejected: zeroCounts(),
      applied: {
        added: trial.attempted.added,
        removed: trial.attempted.removed,
        modified: trial.attempted.modified,
      },
    };
  }

  return {
    nextUnits: cloneValue(currentUnits),
    applied: zeroCounts(),
    rejected: {
      added: trial.attempted.added,
      removed: trial.attempted.removed,
      modified: trial.attempted.modified,
    },
    conflicts: trial.conflicts,
    attempted: trial.attempted,
  };
}

function asLevel(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'low') return 1;
  if (normalized === 'medium') return 2;
  if (normalized === 'high') return 3;
  return null;
}

function buildSemanticFindings(state: unknown): TransitionFinding[] {
  const stateRecord = asRecord(state);
  const constraints = asArray(stateRecord.constraints);
  const risks = asArray(stateRecord.risks);

  if (constraints.length === 0 && risks.length === 0) return [];

  const hasThreshold = constraints.some((constraint) => {
    const record = asRecord(constraint);
    return asLevel(record.maxProbability) !== null || asLevel(record.maxImpact) !== null;
  });

  const hasRiskLevels = risks.some((risk) => {
    const record = asRecord(risk);
    return asLevel(record.probability) !== null || asLevel(record.impact) !== null;
  });

  if (hasThreshold && hasRiskLevels) return [];

  return [
    {
      code: 'F_CONSTRAINT_SEMANTICS_INSUFFICIENT',
      message: 'constraintSemanticsInsufficient=true',
    },
  ];
}

export function applyDelta(
  current: unknown,
  delta: SemanticDelta,
  opts?: { mode: TransitionMode }
): TransitionResult {
  const mode: TransitionMode = opts?.mode ?? 'best_effort';
  const nextState = asRecord(cloneValue(current));
  const applied = zeroPerDomainCounts();
  const rejected = zeroPerDomainCounts();
  const transitionConflicts: TransitionConflict[] = [];

  for (const domain of DOMAIN_ORDER) {
    const location = getDomainLocation(nextState, domain);
    const currentUnits = readDomainUnits(nextState, domain, location);
    const result = applyDomain(domain, currentUnits, delta[domain], mode);
    writeDomainUnits(nextState, domain, location, result.nextUnits);
    applied[domain] = result.applied;
    rejected[domain] = result.rejected;
    transitionConflicts.push(...result.conflicts);
  }

  const semanticConflicts = detectConflicts(nextState);
  const findings = buildSemanticFindings(nextState);

  return {
    nextState,
    applied: { perDomain: applied },
    rejected: { perDomain: rejected },
    conflicts: [...transitionConflicts, ...semanticConflicts].sort(conflictSort),
    findings,
  };
}
