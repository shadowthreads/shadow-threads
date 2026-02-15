import { diffFields } from './fieldChange';
import { computeUnitKey, stableHash, stableStringify } from './key';
import { type DiffDomainResult, type DomainDelta, type DomainName } from './types';

type SelectedDomain = {
  map: Map<string, unknown>;
  soft: string[];
  hard: string[];
};

type Candidate = {
  unit: unknown;
  secondaryHash: string;
};

function selectDeterministicUnits(domain: DomainName, units: unknown[], side: 'base' | 'target'): SelectedDomain {
  const grouped = new Map<string, Candidate[]>();

  for (const unit of units) {
    const primaryKey = computeUnitKey(domain, unit);
    const secondaryHash = stableHash(unit);
    const list = grouped.get(primaryKey);
    if (list) {
      list.push({ unit, secondaryHash });
    } else {
      grouped.set(primaryKey, [{ unit, secondaryHash }]);
    }
  }

  const selected = new Map<string, unknown>();
  const soft: string[] = [];
  const hard: string[] = [];

  for (const primaryKey of [...grouped.keys()].sort()) {
    const candidates = grouped.get(primaryKey)!;
    candidates.sort(
      (a, b) =>
        a.secondaryHash.localeCompare(b.secondaryHash) ||
        stableStringify(a.unit).localeCompare(stableStringify(b.unit))
    );

    selected.set(primaryKey, candidates[0].unit);

    if (candidates.length > 1) {
      const secondaryCounts = new Map<string, number>();

      for (let i = 1; i < candidates.length; i += 1) {
        const collision = candidates[i];
        soft.push(`soft|${domain}|${side}|${primaryKey}|${collision.secondaryHash}`);
      }

      for (const candidate of candidates) {
        secondaryCounts.set(candidate.secondaryHash, (secondaryCounts.get(candidate.secondaryHash) ?? 0) + 1);
      }

      for (const [secondaryHash, count] of [...secondaryCounts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        if (count > 1) {
          hard.push(`hard|${domain}|${side}|${primaryKey}|${secondaryHash}`);
        }
      }
    }
  }

  return { map: selected, soft, hard };
}

function buildDelta(domain: DomainName, baseUnits: unknown[], targetUnits: unknown[]): DiffDomainResult<unknown> {
  const baseSelected = selectDeterministicUnits(domain, baseUnits, 'base');
  const targetSelected = selectDeterministicUnits(domain, targetUnits, 'target');

  const baseMap = baseSelected.map;
  const targetMap = targetSelected.map;
  const baseKeys = [...baseMap.keys()].sort();
  const targetKeys = [...targetMap.keys()].sort();
  const targetKeySet = new Set(targetKeys);
  const baseKeySet = new Set(baseKeys);

  const added: DomainDelta<unknown>['added'] = [];
  for (const key of targetKeys) {
    if (baseKeySet.has(key)) continue;
    added.push({ key, unit: targetMap.get(key)! });
  }

  const removed: DomainDelta<unknown>['removed'] = [];
  for (const key of baseKeys) {
    if (targetKeySet.has(key)) continue;
    removed.push({ key, unit: baseMap.get(key)! });
  }

  const modified: DomainDelta<unknown>['modified'] = [];
  for (const key of baseKeys) {
    if (!targetKeySet.has(key)) continue;

    const before = baseMap.get(key)!;
    const after = targetMap.get(key)!;
    if (stableHash(before) === stableHash(after)) continue;

    modified.push({
      key,
      before,
      after,
      changes: diffFields(domain, before, after),
    });
  }

  const soft = [...new Set([...baseSelected.soft, ...targetSelected.soft])].sort();
  const hard = [...new Set([...baseSelected.hard, ...targetSelected.hard])].sort();

  return {
    delta: {
      added,
      removed,
      modified,
    },
    collisions: {
      soft,
      hard,
    },
  };
}

export function diffDomain(domain: DomainName, baseUnits: unknown[], targetUnits: unknown[]): DiffDomainResult<unknown> {
  return buildDelta(domain, baseUnits, targetUnits);
}
