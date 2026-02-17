# State Algebra and Executable Invariants

This document defines the deterministic algebra used by the TaskPackage state engine.
It is protocol-focused and implementation-backed.

## 1) State S definition (tpkg-0.2 semantic state)

`S` is a normalized semantic state shaped as TaskPackage v0.2:

- `manifest`
- `intent`
- `state`
- `constraints`
- `interfaces`
- `risks`
- `evidence`
- `history`
- `compat`

For algebra execution, five mutable semantic domains are used:

- `facts`
- `decisions`
- `constraints`
- `risks`
- `assumptions`

Domain units are keyed by deterministic identity: `computeUnitKey(domain, unit)`.

## 2) Delta D definition (sdiff-0.1)

`D = diffState(A, B)` where `A` and `B` are semantic states.

`D` has schema `sdiff-0.1` and per-domain change sets:

- `added[]` (unit appears in target only)
- `removed[]` (unit appears in base only)
- `modified[]` (same key, different value-level fields)

`D.meta` includes determinism metadata, collision metadata, and counts.

## 3) Transition F definition

`F(S, D, mode) = applyDelta(S, D, mode)` where:

- `mode = "best_effort"`: apply valid items, reject conflicting items.
- `mode = "strict"`: if any conflict exists in a domain, reject that domain change set atomically.

Output is `TransitionResult`:

- `nextState`
- `applied.perDomain`
- `rejected.perDomain`
- `conflicts`
- `findings`

## 4) Identity I definition

Identity has two layers:

1. Unit identity inside a domain: `computeUnitKey(domain, unit)` (signature-hash strategy).
2. State identity / revision identity: `stableHash(state)` and `revisionHash`.

`stableHash` is deterministic canonical hashing over JSON-safe values.
`revisionHash` is content identity for revision payloads.

## 5) Conflict surface definition

Conflict reporting is additive and explicit:

- Transition-time conflicts: `transition.conflicts`
- Post-apply semantic conflicts on `nextState`: `postApplyConflicts`

No auto-resolution is implied by algebra. Conflict handling remains report-first.

## 6) Lineage and algebra relation

Lineage fields (`parentRevisionId`, revision graph edges) define provenance.
Algebra defines state transformation semantics.

- Lineage answers: "where did this revision come from?"
- Algebra answers: "what changed and what state results?"

Merge semantics are out of scope in this phase.

## 7) Executable invariants

Each invariant includes a directly testable form.

### Inv1: Identity diff

Definition:
- `diffState(S, S)` is empty across all five domains.

Test form:
- assert all `added/removed/modified` lengths are `0`.

### Inv2: Empty delta is neutral

Definition:
- `applyDelta(S, emptyDelta)` preserves semantic state.

Test form:
- build `emptyDelta = diffState(S, S)`.
- assert `stableHash(applyDelta(S, emptyDelta).nextState) == stableHash(S)`.

### Inv3: Determinism

Definition:
- same `(S, D, mode)` always yields the same `TransitionResult`.

Test form:
- run `applyDelta(S, D, mode)` twice.
- assert same `nextState` hash, same `applied/rejected`, same `conflicts`.

### Inv4: Best-effort isolation

Definition:
- in `best_effort`, rejected items do not block other valid items in same domain.

Test form:
- use a delta with one `E_ADD_EXISTS` item and one valid add.
- assert valid add applied and only conflicting item rejected.

### Inv5: Strict domain atomicity

Definition:
- in `strict`, if a domain has any conflict, that domain is fully rejected.

Test form:
- use same mixed delta as Inv4 under `strict`.
- assert domain unchanged and attempted operations counted as rejected.

### Inv6: JSON-safe closure

Definition:
- transition output remains JSON-safe for canonical hashing.

Test form:
- assert `stableHash(result.nextState)` does not throw.

### Inv7: Domain key uniqueness

Definition:
- each domain in resulting state should have unique `computeUnitKey`.

Test form:
- for each domain, compute keys and assert `Set(keys).size == keys.length`.

### Inv8: Reconstruction without conflicts

Definition:
- if there are no conflicts, `applyDelta(S, diffState(S, T))` reconstructs target semantics.

Test form:
- compute `D = diffState(S, T)`.
- apply `R = applyDelta(S, D, best_effort)`.
- assert no conflicts and `stableHash(R.nextState) == stableHash(T)`.

## 8) D composition (o)

Composition operator:

- `D = D1 o D2` means "apply `D1`, then apply `D2`".
- Composition is defined per domain and per identity key (`computeUnitKey`).
- Composition is state-independent (no direct dependence on runtime state `S`).

Deterministic domain processing order:

- `facts`, `decisions`, `constraints`, `risks`, `assumptions`

Deterministic key behavior uses this rule family:

1. `NONE o X = X`, `X o NONE = X`
2. `ADD o ADD = ADD` (later delta wins)
3. `ADD o REMOVE = NONE`
4. `REMOVE o ADD = ADD`
5. `REMOVE o REMOVE = REMOVE`
6. `MODIFY o REMOVE = REMOVE`
7. `REMOVE o MODIFY = REMOVE`
8. `ADD o MODIFY = ADD'` (attempt field-level patch on added unit; deterministic fallback keeps original add)
9. `MODIFY o ADD = ADD` (later delta wins)
10. `MODIFY o MODIFY = MODIFY'` (path-level last-write-wins; deterministic ordering)

Field-change composition invariants:

- Path sort: lexicographic.
- Op sort within path: `set`, `unset`, `append`, `remove`.
- Value hash tie-break is used only for value-carrying ops (`append`, `remove`).

Composition output remains `sdiff-0.1` and recomputes counts deterministically.

### D composition hardening rules

1. REMOVE semantics:
   - composed REMOVE entries are key-only (`{ key }`).
   - no fabricated placeholder payloads are produced.

2. Atomic `ADD o MODIFY`:
   - patching an added unit is all-or-nothing.
   - if any change is unsafe or unsupported for atomic application, no partial patch is kept.
   - deterministic fallback is used: prefer `d2.after` when present, otherwise keep the original added unit.

3. Deterministic sorting safety:
   - sort key is `(path, opOrder, valueHash?)`.
   - `valueHash` is only evaluated for value-carrying ops.
   - non JSON-safe field-change values are rejected with deterministic error:
     - `code = E_DELTA_INVALID`
     - `message = "Non JSON-safe value in fieldChange"`

4. Associativity preconditions:
   - inputs must be valid sdiff-0.1 objects with JSON-safe values.
   - key resolution must remain deterministic (`key` first, then `computeUnitKey` fallback).
   - composition remains state-independent; runtime conflicts are handled at `applyDelta` time.

### P1: Identity element

There exists empty delta `D0` such that:

- `D o D0 = D`
- `D0 o D = D`

Precondition:
- identity delta has no domain ops and composes on matching lineage hashes.

### P2: Associativity

Composition is associative:

- `(D1 o D2) o D3 = D1 o (D2 o D3)`

Test form:
- compare composed delta hashes with `stableHash`.

### P3: Consistency with transition (no-conflict precondition)

Under no-conflict preconditions:

- `applyDelta(S, D1 o D2) == applyDelta(applyDelta(S, D1).nextState, D2)`

Comparison form:

- compare `stableHash(nextState)` equality.
- assert conflict arrays are empty for both evaluation paths.

Precondition:

- The chosen `S`, `D1`, `D2` sequence must be conflict-free under `best_effort`.

## 9) Algebra Closure: (S, D, o, F) and Laws

### A) Definitions

#### Well-formed delta D

A delta `D` is well-formed when:

- it has exactly the five algebra domains: `facts`, `decisions`, `constraints`, `risks`, `assumptions`.
- each domain entry has deterministic key resolution (`entry.key` if present, otherwise `computeUnitKey` fallback).
- each `modified[].changes` list is deterministically sorted by:
  1) `path` lexicographic,
  2) op order `set < unset < append < remove`,
  3) value hash tie-break only for value-carrying ops.
- field-change values are JSON-safe.
- runtime REMOVE is key-only (`{ key }`) in composed output.

#### Identity delta e

`e` is an explicit neutral delta:

- all five domains have `added=[]`, `removed=[]`, `modified=[]`.
- `meta.counts` are all zero (`*.added`, `*.removed`, `*.modified`, collisions).
- `meta.collisions.soft=[]`, `meta.collisions.hard=[]`.
- no non-neutral meta payload is introduced.

`e` is defined only for this neutral meta shape. Structurally empty deltas with non-neutral meta are outside identity definition.

#### Composition operator o

`D = D1 o D2` means applying `D1` then `D2` at algebra level, state-independent, with deterministic per-domain/per-key normalization.

#### Transition operator F

`F(S, D, mode) = applyDelta(S, D, mode)`.

### B) Laws, Preconditions, and Test Forms

#### Law 1: Left identity

Law:
- `e o d = d`

Preconditions:
- `d` is well-formed.
- `e` is meta-neutral identity as defined above.

Test form:
- `stableHash(composeDelta(e, d)) == stableHash(d)`.

#### Law 2: Right identity

Law:
- `d o e = d`

Preconditions:
- `d` is well-formed.
- `e` is meta-neutral identity as defined above.

Test form:
- `stableHash(composeDelta(d, e)) == stableHash(d)`.

#### Law 3: Associativity

Law:
- `(d1 o d2) o d3 = d1 o (d2 o d3)`

Preconditions:
- `d1`, `d2`, `d3` are well-formed.

Test form:
- compare both sides by `stableHash`.

#### Law 4: Canonical determinism

Law:
- equivalent input representations normalize to equal composed delta hash.

Preconditions:
- inputs are well-formed and differ only by representational order.

Test form:
- build equivalent deltas with different insertion order; assert equal `stableHash` after composition.

#### Law 5: Homomorphism (no-conflict precondition)

Law:
- `applyDelta(S, d1 o d2, best_effort) = applyDelta(applyDelta(S, d1, best_effort).nextState, d2, best_effort)`

Preconditions:
- both sequential applies are conflict-free.
- all deltas are well-formed.

Test form:
- assert zero conflicts in both sequential applies and composed apply.
- compare resulting states via `stableHash`.

#### Law 6: Conflict monotonicity (deterministic weak form)

Law:
- if sequential apply is conflict-free, composed apply is conflict-free.

Preconditions:
- `mode=best_effort`.
- deltas are well-formed.

Test form:
- in conflict-free sequential scenario, assert composed conflict count is zero and ordering is deterministic.

### C) Known Type Debts

1. REMOVE runtime/type mismatch:
   - composed runtime uses key-only REMOVE (`{ key }`).
   - current static typing still requires localized assertion in composer output path.

2. Identity meta neutrality scope:
   - identity is defined only for neutral meta.
   - structurally empty deltas with non-neutral meta are not algebraic identity by definition.
