import { getFieldWhitelist } from './fieldWhitelist';
import { stableHash, stableStringify } from './key';
import { type DomainName, type FieldChange } from './types';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return stableStringify(a) === stableStringify(b);
}

function firstValueForHash(values: unknown[]): Map<string, unknown> {
  const buckets = new Map<string, unknown[]>();
  for (const value of values) {
    const hash = stableHash(value);
    const list = buckets.get(hash);
    if (list) {
      list.push(value);
    } else {
      buckets.set(hash, [value]);
    }
  }

  const out = new Map<string, unknown>();
  for (const hash of [...buckets.keys()].sort()) {
    const candidates = buckets.get(hash)!;
    candidates.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
    out.set(hash, candidates[0]);
  }

  return out;
}

function changeSortKey(change: FieldChange): string {
  const payload = change.value ?? change.after ?? change.before ?? null;
  return stableHash(payload);
}

export function diffFields(domain: DomainName, before: unknown, after: unknown): FieldChange[] {
  const beforeRecord = asRecord(before);
  const afterRecord = asRecord(after);
  const changes: FieldChange[] = [];

  for (const path of getFieldWhitelist(domain)) {
    const beforeValue = beforeRecord[path];
    const afterValue = afterRecord[path];

    if (Array.isArray(beforeValue) && Array.isArray(afterValue)) {
      const beforeByHash = firstValueForHash(beforeValue);
      const afterByHash = firstValueForHash(afterValue);

      const appendHashes = [...afterByHash.keys()].filter((hash) => !beforeByHash.has(hash)).sort();
      const removeHashes = [...beforeByHash.keys()].filter((hash) => !afterByHash.has(hash)).sort();

      for (const hash of appendHashes) {
        changes.push({
          path,
          op: 'append',
          value: afterByHash.get(hash),
        });
      }

      for (const hash of removeHashes) {
        changes.push({
          path,
          op: 'remove',
          value: beforeByHash.get(hash),
        });
      }

      continue;
    }

    if (valuesEqual(beforeValue, afterValue)) continue;

    if (beforeValue === undefined && afterValue !== undefined) {
      changes.push({
        path,
        op: 'set',
        after: afterValue,
      });
      continue;
    }

    if (beforeValue !== undefined && afterValue === undefined) {
      changes.push({
        path,
        op: 'unset',
        before: beforeValue,
      });
      continue;
    }

    changes.push({
      path,
      op: 'set',
      before: beforeValue,
      after: afterValue,
    });
  }

  changes.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.op.localeCompare(b.op) ||
      changeSortKey(a).localeCompare(changeSortKey(b))
  );

  return changes;
}
