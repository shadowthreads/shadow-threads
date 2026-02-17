import { canonicalizeDeep, computeUnitKey, stableHash } from '../semanticDiff/key';
import type { DomainDelta, DomainName, FieldChange, SemanticDelta } from '../semanticDiff/types';

const DOMAIN_ORDER: DomainName[] = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];
const FIELD_OP_ORDER: Record<FieldChange['op'], number> = {
  set: 0,
  unset: 1,
  append: 2,
  remove: 3,
};
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

type DeltaComposeErrorCode = 'E_DELTA_INVALID';
type DeltaComposeError = Error & { code: DeltaComposeErrorCode };

type Effect =
  | { kind: 'none' }
  | { kind: 'add'; unit: unknown }
  | { kind: 'remove' }
  | { kind: 'modify'; before?: unknown; after?: unknown; changes: FieldChange[] };

const NONE_EFFECT: Effect = { kind: 'none' };

function throwDeltaInvalid(message: string): never {
  const err = new Error(message) as DeltaComposeError;
  err.code = 'E_DELTA_INVALID';
  throw err;
}

function cloneJsonSafe<T>(value: T, context: 'delta' | 'fieldChange'): T {
  try {
    return JSON.parse(JSON.stringify(canonicalizeDeep(value))) as T;
  } catch {
    if (context === 'fieldChange') {
      throwDeltaInvalid('Non JSON-safe value in fieldChange');
    }
    throwDeltaInvalid('Invalid delta input');
  }
}

function hashJsonSafe(value: unknown, context: 'delta' | 'fieldChange'): string {
  try {
    return stableHash(value);
  } catch {
    if (context === 'fieldChange') {
      throwDeltaInvalid('Non JSON-safe value in fieldChange');
    }
    throwDeltaInvalid('Invalid delta input');
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deriveAddedKey(domain: DomainName, item: DomainDelta<unknown>['added'][number]): string {
  if (typeof item.key === 'string' && item.key.length > 0) return item.key;
  return computeUnitKey(domain, item.unit);
}

function deriveRemovedKey(domain: DomainName, item: DomainDelta<unknown>['removed'][number]): string {
  if (typeof item.key === 'string' && item.key.length > 0) return item.key;
  if ('unit' in item && (item as { unit?: unknown }).unit !== undefined) {
    return computeUnitKey(domain, (item as { unit: unknown }).unit);
  }
  throwDeltaInvalid('Removed entry missing key');
}

function deriveModifiedKey(domain: DomainName, item: DomainDelta<unknown>['modified'][number]): string {
  if (typeof item.key === 'string' && item.key.length > 0) return item.key;
  if (item.before !== undefined) return computeUnitKey(domain, item.before);
  if (item.after !== undefined) return computeUnitKey(domain, item.after);
  throwDeltaInvalid('Modified entry missing key/before/after');
}

function splitPath(path: string): string[] {
  if (typeof path !== 'string' || path.length === 0) {
    throwDeltaInvalid('Invalid fieldChange path');
  }

  const segments = path.split('.');
  if (segments.some((segment) => segment.length === 0)) {
    throwDeltaInvalid('Invalid fieldChange path');
  }
  return segments;
}

function ensureSafePath(path: string): string[] {
  const segments = splitPath(path);
  if (segments.some((segment) => UNSAFE_PATH_SEGMENTS.has(segment))) {
    throwDeltaInvalid('Invalid fieldChange path');
  }
  return segments;
}

function getContainerForPath(
  root: Record<string, unknown>,
  path: string,
  allowCreate: boolean
): { container: Record<string, unknown>; key: string } | null {
  const segments = ensureSafePath(path);
  const key = segments[segments.length - 1];
  let cursor = root;

  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      if (!allowCreate) return null;
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }

  return { container: cursor, key };
}

function validateFieldChange(change: FieldChange): void {
  splitPath(change.path);
  if (change.op === 'append' || change.op === 'remove') {
    if (change.value === undefined) {
      throwDeltaInvalid('Invalid fieldChange operation');
    }
    hashJsonSafe(change.value, 'fieldChange');
    return;
  }

  if (change.op === 'set') {
    if (change.after !== undefined) {
      hashJsonSafe(change.after, 'fieldChange');
    } else if (change.value !== undefined) {
      hashJsonSafe(change.value, 'fieldChange');
    }
    return;
  }

  if (change.op !== 'unset') {
    throwDeltaInvalid('Invalid fieldChange operation');
  }
}

function valueHashForSort(change: FieldChange): string {
  if (change.op === 'append' || change.op === 'remove') {
    if (change.value === undefined) throwDeltaInvalid('Invalid fieldChange operation');
    return hashJsonSafe(change.value, 'fieldChange');
  }
  return '';
}

function compareFieldChanges(a: FieldChange, b: FieldChange): number {
  return (
    a.path.localeCompare(b.path) ||
    FIELD_OP_ORDER[a.op] - FIELD_OP_ORDER[b.op] ||
    valueHashForSort(a).localeCompare(valueHashForSort(b))
  );
}

type PathBucket = {
  scalar?: FieldChange;
  arrayOps: Map<string, FieldChange>;
};

function normalizeScalar(change: FieldChange): FieldChange {
  if (change.op === 'set') {
    if (change.after !== undefined) return { path: change.path, op: 'set', after: cloneJsonSafe(change.after, 'fieldChange') };
    if (change.value !== undefined) return { path: change.path, op: 'set', value: cloneJsonSafe(change.value, 'fieldChange') };
    return { path: change.path, op: 'set' };
  }
  return change.before !== undefined
    ? { path: change.path, op: 'unset', before: cloneJsonSafe(change.before, 'fieldChange') }
    : { path: change.path, op: 'unset' };
}

function normalizeArrayChange(change: FieldChange): FieldChange {
  if (change.value === undefined) throwDeltaInvalid('Invalid fieldChange operation');
  return {
    path: change.path,
    op: change.op,
    value: cloneJsonSafe(change.value, 'fieldChange'),
  };
}

function composeFieldChanges(changes1: FieldChange[], changes2: FieldChange[]): FieldChange[] {
  const buckets = new Map<string, PathBucket>();

  const process = (change: FieldChange) => {
    validateFieldChange(change);
    const current = buckets.get(change.path) ?? { arrayOps: new Map<string, FieldChange>() };

    if (change.op === 'set' || change.op === 'unset') {
      current.scalar = normalizeScalar(change);
      current.arrayOps.clear();
      buckets.set(change.path, current);
      return;
    }

    const normalized = normalizeArrayChange(change);
    if (current.scalar) {
      current.scalar = undefined;
      current.arrayOps.clear();
    }
    const h = valueHashForSort(normalized);
    current.arrayOps.set(h, normalized);
    buckets.set(change.path, current);
  };

  for (const change of changes1) process(change);
  for (const change of changes2) process(change);

  const out: FieldChange[] = [];
  for (const path of [...buckets.keys()].sort()) {
    const bucket = buckets.get(path)!;
    if (bucket.scalar) {
      out.push(bucket.scalar);
      continue;
    }
    const ops = [...bucket.arrayOps.values()].sort(compareFieldChanges);
    out.push(...ops);
  }
  return out.sort(compareFieldChanges);
}

function normalizeModifyEffect(effect: Effect): Effect {
  if (effect.kind !== 'modify') return effect;
  const changes = composeFieldChanges([], effect.changes);
  if (changes.length === 0) return NONE_EFFECT;
  return {
    kind: 'modify',
    before: effect.before !== undefined ? cloneJsonSafe(effect.before, 'delta') : undefined,
    after: effect.after !== undefined ? cloneJsonSafe(effect.after, 'delta') : undefined,
    changes,
  };
}

function applyFieldChangesAtomically(unit: unknown, changes: FieldChange[]): { ok: boolean; unit: unknown } {
  if (!isPlainObject(unit)) return { ok: false, unit };
  const draft = cloneJsonSafe(unit, 'delta') as Record<string, unknown>;

  for (const change of changes) {
    validateFieldChange(change);
    let containerRef: { container: Record<string, unknown>; key: string } | null = null;
    try {
      containerRef = getContainerForPath(draft, change.path, true);
    } catch {
      return { ok: false, unit };
    }
    if (!containerRef) return { ok: false, unit };
    const { container, key } = containerRef;

    if (change.op === 'set') {
      if (change.after !== undefined) {
        container[key] = cloneJsonSafe(change.after, 'fieldChange');
      } else if (change.value !== undefined) {
        container[key] = cloneJsonSafe(change.value, 'fieldChange');
      } else {
        delete container[key];
      }
      continue;
    }

    if (change.op === 'unset') {
      delete container[key];
      continue;
    }

    const current = container[key];
    if (current !== undefined && !Array.isArray(current)) {
      return { ok: false, unit };
    }
    const arr = Array.isArray(current) ? [...current] : [];

    if (change.op === 'append') {
      if (change.value === undefined) return { ok: false, unit };
      arr.push(cloneJsonSafe(change.value, 'fieldChange'));
      container[key] = arr;
      continue;
    }

    if (change.op === 'remove') {
      if (change.value === undefined) return { ok: false, unit };
      const removeHash = hashJsonSafe(change.value, 'fieldChange');
      const at = arr.findIndex((item) => hashJsonSafe(item, 'fieldChange') === removeHash);
      if (at >= 0) arr.splice(at, 1);
      container[key] = arr;
      continue;
    }
  }

  return { ok: true, unit: draft };
}

function composeEffects(domain: DomainName, left: Effect, right: Effect): Effect {
  if (left.kind === 'none') return normalizeModifyEffect(right);
  if (right.kind === 'none') return normalizeModifyEffect(left);

  if (left.kind === 'add' && right.kind === 'add') {
    return { kind: 'add', unit: cloneJsonSafe(right.unit, 'delta') };
  }

  if (left.kind === 'add' && right.kind === 'remove') {
    return NONE_EFFECT;
  }

  if (left.kind === 'remove' && right.kind === 'add') {
    return { kind: 'add', unit: cloneJsonSafe(right.unit, 'delta') };
  }

  if (left.kind === 'remove' && right.kind === 'remove') {
    return { kind: 'remove' };
  }

  if (left.kind === 'modify' && right.kind === 'remove') {
    return { kind: 'remove' };
  }

  if (left.kind === 'remove' && right.kind === 'modify') {
    return { kind: 'remove' };
  }

  if (left.kind === 'add' && right.kind === 'modify') {
    const normalizedRight = normalizeModifyEffect(right);
    if (normalizedRight.kind !== 'modify') return left;
    const patched = applyFieldChangesAtomically(left.unit, normalizedRight.changes);
    if (patched.ok) {
      return { kind: 'add', unit: patched.unit };
    }
    const fallbackUnit =
      normalizedRight.after !== undefined
        ? cloneJsonSafe(normalizedRight.after, 'delta')
        : cloneJsonSafe(left.unit, 'delta');
    return { kind: 'add', unit: fallbackUnit };
  }

  if (left.kind === 'modify' && right.kind === 'add') {
    return { kind: 'add', unit: cloneJsonSafe(right.unit, 'delta') };
  }

  if (left.kind === 'modify' && right.kind === 'modify') {
    const changes = composeFieldChanges(left.changes, right.changes);
    if (changes.length === 0) return NONE_EFFECT;

    const before =
      left.before !== undefined
        ? cloneJsonSafe(left.before, 'delta')
        : right.before !== undefined
        ? cloneJsonSafe(right.before, 'delta')
        : undefined;

    let after =
      right.after !== undefined
        ? cloneJsonSafe(right.after, 'delta')
        : undefined;
    if (after === undefined && before !== undefined) {
      const patched = applyFieldChangesAtomically(before, changes);
      if (patched.ok) after = patched.unit;
    }
    if (after === undefined) {
      after =
        left.after !== undefined
          ? cloneJsonSafe(left.after, 'delta')
          : before;
    }

    return {
      kind: 'modify',
      before,
      after,
      changes,
    };
  }

  void domain;
  return normalizeModifyEffect(right);
}

function composeWithinDelta(domain: DomainName, delta: DomainDelta<unknown>): Map<string, Effect> {
  const out = new Map<string, Effect>();

  const added = [...delta.added].sort(
    (a, b) =>
      deriveAddedKey(domain, a).localeCompare(deriveAddedKey(domain, b)) ||
      hashJsonSafe(a.unit, 'delta').localeCompare(hashJsonSafe(b.unit, 'delta'))
  );
  for (const item of added) {
    const key = deriveAddedKey(domain, item);
    const current = out.get(key) ?? NONE_EFFECT;
    out.set(key, composeEffects(domain, current, { kind: 'add', unit: cloneJsonSafe(item.unit, 'delta') }));
  }

  const removed = [...delta.removed].sort((a, b) => deriveRemovedKey(domain, a).localeCompare(deriveRemovedKey(domain, b)));
  for (const item of removed) {
    const key = deriveRemovedKey(domain, item);
    const current = out.get(key) ?? NONE_EFFECT;
    out.set(key, composeEffects(domain, current, { kind: 'remove' }));
  }

  const modified = [...delta.modified].sort(
    (a, b) =>
      deriveModifiedKey(domain, a).localeCompare(deriveModifiedKey(domain, b)) ||
      hashJsonSafe(a.changes, 'fieldChange').localeCompare(hashJsonSafe(b.changes, 'fieldChange'))
  );
  for (const item of modified) {
    const key = deriveModifiedKey(domain, item);
    const current = out.get(key) ?? NONE_EFFECT;
    const composedChanges = composeFieldChanges([], item.changes);
    const before = item.before !== undefined ? cloneJsonSafe(item.before, 'delta') : undefined;
    const after = item.after !== undefined ? cloneJsonSafe(item.after, 'delta') : undefined;
    out.set(
      key,
      composeEffects(domain, current, {
        kind: 'modify',
        before,
        after,
        changes: composedChanges,
      })
    );
  }

  for (const key of [...out.keys()]) {
    if ((out.get(key) ?? NONE_EFFECT).kind === 'none') {
      out.delete(key);
    }
  }

  return out;
}

function toDomainDelta(effects: Map<string, Effect>): DomainDelta<unknown> {
  const added: DomainDelta<unknown>['added'] = [];
  const removed: DomainDelta<unknown>['removed'] = [];
  const modified: DomainDelta<unknown>['modified'] = [];

  for (const key of [...effects.keys()].sort()) {
    const effect = effects.get(key)!;
    if (effect.kind === 'add') {
      added.push({ key, unit: cloneJsonSafe(effect.unit, 'delta') });
      continue;
    }
    if (effect.kind === 'remove') {
      removed.push({ key } as DomainDelta<unknown>['removed'][number]);
      continue;
    }
    if (effect.kind === 'modify') {
      if (effect.before === undefined && effect.after === undefined) {
        throwDeltaInvalid('Invalid modify effect');
      }
      const before = effect.before !== undefined ? cloneJsonSafe(effect.before, 'delta') : cloneJsonSafe(effect.after, 'delta');
      const after = effect.after !== undefined ? cloneJsonSafe(effect.after, 'delta') : cloneJsonSafe(effect.before, 'delta');
      modified.push({
        key,
        before,
        after,
        changes: composeFieldChanges([], effect.changes),
      });
    }
  }

  return { added, removed, modified };
}

function unionSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function makeCounts(
  domains: Record<DomainName, DomainDelta<unknown>>,
  collisions: { soft: string[]; hard: string[] }
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const domain of DOMAIN_ORDER) {
    counts[`${domain}.added`] = domains[domain].added.length;
    counts[`${domain}.removed`] = domains[domain].removed.length;
    counts[`${domain}.modified`] = domains[domain].modified.length;
  }
  counts['collisions.soft'] = collisions.soft.length;
  counts['collisions.hard'] = collisions.hard.length;
  return counts;
}

export function composeDelta(d1: SemanticDelta, d2: SemanticDelta): SemanticDelta {
  const domains = {} as Record<DomainName, DomainDelta<unknown>>;

  for (const domain of DOMAIN_ORDER) {
    const left = composeWithinDelta(domain, d1[domain]);
    const right = composeWithinDelta(domain, d2[domain]);
    const composed = new Map<string, Effect>();

    for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
      const leftEffect = left.get(key) ?? NONE_EFFECT;
      const rightEffect = right.get(key) ?? NONE_EFFECT;
      const effect = composeEffects(domain, leftEffect, rightEffect);
      if (effect.kind !== 'none') composed.set(key, effect);
    }

    domains[domain] = toDomainDelta(composed);
  }

  const collisions = {
    soft: unionSorted([...(d1.meta?.collisions?.soft ?? []), ...(d2.meta?.collisions?.soft ?? [])]),
    hard: unionSorted([...(d1.meta?.collisions?.hard ?? []), ...(d2.meta?.collisions?.hard ?? [])]),
  };

  const determinism =
    d1.meta?.determinism ??
    d2.meta?.determinism ?? {
      canonicalVersion: 'tpkg-0.2-canon-v1' as const,
      keyStrategy: 'sig-hash-v1' as const,
      tieBreakers: ['compose-last-write-wins'],
    };

  return {
    schemaVersion: 'sdiff-0.1',
    base: { revisionHash: d1.base?.revisionHash ?? '' },
    target: { revisionHash: d2.target?.revisionHash ?? '' },
    facts: domains.facts,
    decisions: domains.decisions,
    constraints: domains.constraints,
    risks: domains.risks,
    assumptions: domains.assumptions,
    meta: {
      determinism,
      collisions,
      ...(d1.meta?.assumptionsDerived === true || d2.meta?.assumptionsDerived === true ? { assumptionsDerived: true } : {}),
      counts: makeCounts(domains, collisions),
    },
  };
}
