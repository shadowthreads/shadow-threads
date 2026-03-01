import { createHash } from 'crypto';

export type RevisionIdentityV1 = {
  packageId: string;
  revisionId: string;
  revisionHash: string;
  parentRevisionId: string | null;
};

export type LineageTransferBindingV1 = {
  schema: 'transfer-package-1';
  transferHash: string;
} | null;

export type LineageClosureBindingV1 = {
  schema: 'closure-contract-1';
  proposedHash: string;
  acceptedHash: string;
} | null;

export type LineageExecutionBindingV1 = {
  schema: 'execution-record-1';
  reportHash: string | null;
  deltaHash: string | null;
} | null;

export type LineageHandoffBindingV1 = {
  schema: 'handoff-record-1';
  handoffHash: string;
} | null;

export type LineageBindingV1 = {
  schema: 'lineage-binding-1';
  identity: RevisionIdentityV1;
  bindings: {
    transfer: LineageTransferBindingV1;
    closure: LineageClosureBindingV1;
    execution: LineageExecutionBindingV1;
    handoff: LineageHandoffBindingV1;
  };
  diagnostics: {
    missing: string[];
    notes: string[];
  };
  createdAt: string | null;
  lineageHash: string;
};

export type BuildLineageBindingV1Input = {
  identity: RevisionIdentityV1;
  bindings?: {
    transfer?: LineageTransferBindingV1;
    closure?: LineageClosureBindingV1;
    execution?: LineageExecutionBindingV1;
    handoff?: LineageHandoffBindingV1;
  };
  diagnostics?: {
    notes?: string[];
  };
  createdAt?: string | null;
};

const MISSING_KEYS = ['transfer', 'closure', 'execution', 'handoff'] as const;

type MissingKey = (typeof MISSING_KEYS)[number];
type CanonicalBindings = LineageBindingV1['bindings'];
type CanonicalPayload = Omit<LineageBindingV1, 'createdAt' | 'lineageHash'>;

function makeLineageError(
  code: 'E_LINEAGE_INVALID' | 'E_LINEAGE_NON_JSON_SAFE' | 'E_LINEAGE_HASH_MISMATCH',
  message: string
): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isLowerHex64(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isMissingKey(value: unknown): value is MissingKey {
  return value === 'transfer' || value === 'closure' || value === 'execution' || value === 'handoff';
}

export function assertJsonSafe(value: unknown): void {
  if (value === null) return;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return;
  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw makeLineageError('E_LINEAGE_NON_JSON_SAFE', 'Lineage binding contains non JSON-safe value');
    }
    return;
  }
  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
    throw makeLineageError('E_LINEAGE_NON_JSON_SAFE', 'Lineage binding contains non JSON-safe value');
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      assertJsonSafe(entry);
    }
    return;
  }

  if (!isPlainObject(value)) {
    throw makeLineageError('E_LINEAGE_NON_JSON_SAFE', 'Lineage binding contains non JSON-safe value');
  }

  const keys = Object.keys(value).sort(compareStrings);
  for (const key of keys) {
    assertJsonSafe(value[key]);
  }
}

export function stableStringify(value: unknown): string {
  assertJsonSafe(value);

  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareStrings);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function normalizeIdentity(value: unknown): RevisionIdentityV1 {
  if (!isPlainObject(value)) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  if (
    typeof value.packageId !== 'string' ||
    typeof value.revisionId !== 'string' ||
    typeof value.revisionHash !== 'string' ||
    !(typeof value.parentRevisionId === 'string' || value.parentRevisionId === null)
  ) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }

  return {
    packageId: value.packageId,
    revisionId: value.revisionId,
    revisionHash: value.revisionHash,
    parentRevisionId: value.parentRevisionId,
  };
}

function normalizeTransferBinding(value: unknown): LineageTransferBindingV1 {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  if (value.schema !== 'transfer-package-1' || !isLowerHex64(value.transferHash)) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  return {
    schema: 'transfer-package-1',
    transferHash: value.transferHash,
  };
}

function normalizeClosureBinding(value: unknown): LineageClosureBindingV1 {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  if (value.schema !== 'closure-contract-1' || !isLowerHex64(value.proposedHash) || !isLowerHex64(value.acceptedHash)) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  return {
    schema: 'closure-contract-1',
    proposedHash: value.proposedHash,
    acceptedHash: value.acceptedHash,
  };
}

function normalizeExecutionHash(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!isLowerHex64(value)) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  return value;
}

function normalizeExecutionBinding(value: unknown): LineageExecutionBindingV1 {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  if (value.schema !== 'execution-record-1') {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  return {
    schema: 'execution-record-1',
    reportHash: normalizeExecutionHash(value.reportHash),
    deltaHash: normalizeExecutionHash(value.deltaHash),
  };
}

function normalizeHandoffBinding(value: unknown): LineageHandoffBindingV1 {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  if (value.schema !== 'handoff-record-1' || !isLowerHex64(value.handoffHash)) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  return {
    schema: 'handoff-record-1',
    handoffHash: value.handoffHash,
  };
}

function normalizeBindings(value: unknown, allowMissingObject: boolean): CanonicalBindings {
  if (value === undefined && allowMissingObject) {
    return {
      transfer: null,
      closure: null,
      execution: null,
      handoff: null,
    };
  }
  if (!isPlainObject(value)) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  return {
    transfer: normalizeTransferBinding(value.transfer),
    closure: normalizeClosureBinding(value.closure),
    execution: normalizeExecutionBinding(value.execution),
    handoff: normalizeHandoffBinding(value.handoff),
  };
}

function normalizeNotes(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  assertJsonSafe(value);
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
    }
    normalized.push(entry);
  }
  return normalized.sort(compareStrings);
}

function validateProvidedMissing(value: unknown): void {
  if (!Array.isArray(value)) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  assertJsonSafe(value);
  for (const entry of value) {
    if (!isMissingKey(entry)) {
      throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
    }
  }
}

function computeMissing(bindings: CanonicalBindings): string[] {
  const missing: string[] = [];
  for (const key of MISSING_KEYS) {
    if (bindings[key] === null) {
      missing.push(key);
    }
  }
  return missing;
}

function buildCanonicalPayload(args: {
  identity: unknown;
  bindings: unknown;
  notes: unknown;
  allowMissingBindingsObject: boolean;
}): CanonicalPayload {
  const identity = normalizeIdentity(args.identity);
  const bindings = normalizeBindings(args.bindings, args.allowMissingBindingsObject);
  const notes = normalizeNotes(args.notes);

  return {
    schema: 'lineage-binding-1',
    identity,
    bindings,
    diagnostics: {
      missing: computeMissing(bindings),
      notes,
    },
  };
}

function getVerificationInput(binding: unknown): {
  lineageHash: string;
  createdAt: string | null;
  canonicalPayload: CanonicalPayload;
} {
  if (!isPlainObject(binding) || binding.schema !== 'lineage-binding-1') {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  if (!isLowerHex64(binding.lineageHash)) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  if (!(typeof binding.createdAt === 'string' || binding.createdAt === null)) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }
  if (!isPlainObject(binding.diagnostics)) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }

  validateProvidedMissing(binding.diagnostics.missing);

  const canonicalPayload = buildCanonicalPayload({
    identity: binding.identity,
    bindings: binding.bindings,
    notes: binding.diagnostics.notes,
    allowMissingBindingsObject: false,
  });

  return {
    lineageHash: binding.lineageHash,
    createdAt: binding.createdAt,
    canonicalPayload,
  };
}

export function buildLineageBindingV1(input: BuildLineageBindingV1Input): LineageBindingV1 {
  if (!input || !isPlainObject(input) || input.identity === undefined) {
    throw makeLineageError('E_LINEAGE_INVALID', 'Lineage binding input is invalid');
  }

  const canonicalPayload = buildCanonicalPayload({
    identity: input.identity,
    bindings: input.bindings,
    notes: input.diagnostics?.notes,
    allowMissingBindingsObject: true,
  });

  const createdAt = typeof input.createdAt === 'string' ? input.createdAt : input.createdAt === null ? null : null;
  const lineageHash = sha256Hex(stableStringify(canonicalPayload));

  const binding: LineageBindingV1 = {
    ...canonicalPayload,
    createdAt,
    lineageHash,
  };

  assertJsonSafe(binding);
  return binding;
}

export function recomputeLineageBindingV1Hash(binding: LineageBindingV1): string {
  assertJsonSafe(binding);
  const verificationInput = getVerificationInput(binding);
  return sha256Hex(stableStringify(verificationInput.canonicalPayload));
}

export function verifyLineageBindingV1(binding: LineageBindingV1): { ok: true; recomputedHash: string; matches: boolean } {
  assertJsonSafe(binding);
  const verificationInput = getVerificationInput(binding);
  const recomputedHash = sha256Hex(stableStringify(verificationInput.canonicalPayload));
  return {
    ok: true,
    recomputedHash,
    matches: recomputedHash === verificationInput.lineageHash,
  };
}

export function verifyLineageBindingV1OrThrow(binding: LineageBindingV1): void {
  const verification = verifyLineageBindingV1(binding);
  if (!verification.matches) {
    throw makeLineageError('E_LINEAGE_HASH_MISMATCH', 'Lineage binding hash mismatch');
  }
}
