import { diffDomain } from './diffDomain';
import { type DomainDelta, type SemanticDelta } from './types';

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readRevisionHash(payload: unknown): string {
  const record = asRecord(payload);
  const topLevelHash = record.revisionHash;
  if (typeof topLevelHash === 'string') return topLevelHash;

  const manifest = asRecord(record.manifest);
  const manifestHash = manifest.revisionHash;
  return typeof manifestHash === 'string' ? manifestHash : '';
}

function readFacts(payload: unknown): unknown[] {
  const record = asRecord(payload);
  return asArray(record.facts ?? asRecord(record.state).facts);
}

function readDecisions(payload: unknown): unknown[] {
  const record = asRecord(payload);
  return asArray(record.decisions ?? asRecord(record.state).decisions);
}

function readConstraints(payload: unknown): unknown[] {
  const record = asRecord(payload);
  const constraints = record.constraints ?? asRecord(record.state).constraints;
  if (Array.isArray(constraints)) return constraints;

  const constraintRecord = asRecord(constraints);
  const scopes: Array<'technical' | 'process' | 'policy'> = ['technical', 'process', 'policy'];
  const flattened: Array<{ scope: string; rule: unknown }> = [];

  for (const scope of scopes) {
    for (const rule of asArray(constraintRecord[scope])) {
      flattened.push({ scope, rule });
    }
  }

  return flattened;
}

function readRisks(payload: unknown): unknown[] {
  const record = asRecord(payload);
  return asArray(record.risks ?? asRecord(record.state).risks);
}

function deriveAssumptionsFromFacts(facts: unknown[]): unknown[] {
  return facts.filter((fact) => {
    const record = asRecord(fact);
    if (Object.keys(record).length === 0) return false;
    const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
    const category = typeof record.category === 'string' ? record.category.toLowerCase() : '';
    return type === 'assumption' || category === 'assumption';
  });
}

function readAssumptions(payload: unknown, facts: unknown[]): { items: unknown[]; derived: boolean } {
  const record = asRecord(payload);
  const explicit = record.assumptions ?? asRecord(record.state).assumptions;
  if (Array.isArray(explicit)) {
    return { items: explicit, derived: false };
  }
  return {
    items: deriveAssumptionsFromFacts(facts),
    derived: true,
  };
}

function applyCounts(prefix: string, delta: DomainDelta<unknown>, counts: Record<string, number>) {
  counts[`${prefix}.added`] = delta.added.length;
  counts[`${prefix}.removed`] = delta.removed.length;
  counts[`${prefix}.modified`] = delta.modified.length;
}

export function diffState(baseState: unknown, targetState: unknown): SemanticDelta {
  const factsBase = readFacts(baseState);
  const factsTarget = readFacts(targetState);
  const decisionsBase = readDecisions(baseState);
  const decisionsTarget = readDecisions(targetState);
  const constraintsBase = readConstraints(baseState);
  const constraintsTarget = readConstraints(targetState);
  const risksBase = readRisks(baseState);
  const risksTarget = readRisks(targetState);

  const assumptionsBase = readAssumptions(baseState, factsBase);
  const assumptionsTarget = readAssumptions(targetState, factsTarget);

  const facts = diffDomain('facts', factsBase, factsTarget);
  const decisions = diffDomain('decisions', decisionsBase, decisionsTarget);
  const constraints = diffDomain('constraints', constraintsBase, constraintsTarget);
  const risks = diffDomain('risks', risksBase, risksTarget);
  const assumptions = diffDomain('assumptions', assumptionsBase.items, assumptionsTarget.items);

  const collisionsSoft = [
    ...facts.collisions.soft,
    ...decisions.collisions.soft,
    ...constraints.collisions.soft,
    ...risks.collisions.soft,
    ...assumptions.collisions.soft,
  ];

  const collisionsHard = [
    ...facts.collisions.hard,
    ...decisions.collisions.hard,
    ...constraints.collisions.hard,
    ...risks.collisions.hard,
    ...assumptions.collisions.hard,
  ];

  const counts: Record<string, number> = {};
  applyCounts('facts', facts.delta, counts);
  applyCounts('decisions', decisions.delta, counts);
  applyCounts('constraints', constraints.delta, counts);
  applyCounts('risks', risks.delta, counts);
  applyCounts('assumptions', assumptions.delta, counts);
  counts['collisions.soft'] = new Set(collisionsSoft).size;
  counts['collisions.hard'] = new Set(collisionsHard).size;

  const assumptionsDerived = assumptionsBase.derived || assumptionsTarget.derived;

  return {
    schemaVersion: 'sdiff-0.1',
    base: { revisionHash: readRevisionHash(baseState) },
    target: { revisionHash: readRevisionHash(targetState) },
    facts: facts.delta,
    decisions: decisions.delta,
    constraints: constraints.delta,
    risks: risks.delta,
    assumptions: assumptions.delta,
    meta: {
      determinism: {
        canonicalVersion: 'tpkg-0.2-canon-v1',
        keyStrategy: 'sig-hash-v1',
        tieBreakers: [
          'primaryKey=sha256(signature)',
          'secondaryHash=sha256(unit-canonical)',
          'lexicographic-order',
        ],
      },
      collisions: {
        soft: [...new Set(collisionsSoft)].sort(),
        hard: [...new Set(collisionsHard)].sort(),
      },
      ...(assumptionsDerived ? { assumptionsDerived: true } : {}),
      counts,
    },
  };
}
