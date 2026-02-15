export type DomainName = 'facts' | 'decisions' | 'constraints' | 'risks' | 'assumptions';

export type FieldChangeOp = 'set' | 'unset' | 'append' | 'remove';

export type FieldChange = {
  path: string;
  op: FieldChangeOp;
  before?: unknown;
  after?: unknown;
  value?: unknown;
};

export type DomainDelta<T> = {
  added: Array<{ key: string; unit: T }>;
  removed: Array<{ key: string; unit: T }>;
  modified: Array<{ key: string; before: T; after: T; changes: FieldChange[] }>;
};

export type DeterminismMeta = {
  canonicalVersion: 'tpkg-0.2-canon-v1';
  keyStrategy: 'sig-hash-v1';
  tieBreakers: string[];
};

export type CollisionMeta = {
  hard: string[];
  soft: string[];
};

export type SemanticDelta = {
  schemaVersion: 'sdiff-0.1';
  base: { revisionHash: string };
  target: { revisionHash: string };
  facts: DomainDelta<unknown>;
  decisions: DomainDelta<unknown>;
  constraints: DomainDelta<unknown>;
  risks: DomainDelta<unknown>;
  assumptions: DomainDelta<unknown>;
  meta: {
    determinism: DeterminismMeta;
    collisions: CollisionMeta;
    assumptionsDerived?: boolean;
    counts: Record<string, number>;
  };
};

export type DiffDomainResult<T> = {
  delta: DomainDelta<T>;
  collisions: CollisionMeta;
};
