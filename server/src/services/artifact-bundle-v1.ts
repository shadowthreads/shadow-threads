import { createHash } from 'crypto';
import type { TransferPackageV1 } from './transfer-package-v1';
import type { LineageBindingV1 } from './lineage-binding-v1';
import type { HandoffRecordV1 } from './handoff-record-v1';

export type ClosureContractRefV1 = {
  schema: 'closure-contract-1';
  proposedHash: string;
  acceptedHash: string;
} | null;

export type ArtifactBundleV1 = {
  schema: 'artifact-bundle-1';
  identity: {
    packageId: string;
    revisionId: string | null;
    revisionHash: string | null;
  };
  artifacts: {
    transferPackageV1: TransferPackageV1;
    lineageBindingV1: LineageBindingV1;
    handoffRecordV1: HandoffRecordV1;
    closureContractV1: ClosureContractRefV1;
  };
  diagnostics: {
    invariants: Array<{ code: string; ok: boolean; message: string }>;
    notes: string[];
  };
  createdAt: string | null;
  bundleHash: string;
};

export type BuildArtifactBundleV1Input = {
  identity: {
    packageId: string;
    revisionId?: string | null;
    revisionHash?: string | null;
  };
  artifacts: {
    transferPackageV1: TransferPackageV1;
    lineageBindingV1: LineageBindingV1;
    handoffRecordV1: HandoffRecordV1;
    closureContractV1?: ClosureContractRefV1;
  };
  diagnostics?: {
    notes?: string[];
  };
  createdAt?: string | null;
};

type BundleHashPayload = Omit<ArtifactBundleV1, 'createdAt' | 'bundleHash'>;

type InvariantCode =
  | 'INV_TRANSFER_HASH_MATCH_LINEAGE'
  | 'INV_EMBEDDED_LINEAGE_HASH_MATCH_TOP'
  | 'INV_NO_HANDOFF_BINDING_IN_LINEAGE'
  | 'INV_JSON_SAFE';

const INVARIANT_ORDER: readonly InvariantCode[] = [
  'INV_TRANSFER_HASH_MATCH_LINEAGE',
  'INV_EMBEDDED_LINEAGE_HASH_MATCH_TOP',
  'INV_NO_HANDOFF_BINDING_IN_LINEAGE',
  'INV_JSON_SAFE',
];

function makeBundleError(
  code: 'E_BUNDLE_INVALID' | 'E_BUNDLE_NON_JSON_SAFE' | 'E_BUNDLE_HASH_MISMATCH',
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

function normalizeNullableString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return null;
  throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
    }
    normalized.push(entry);
  }
  return [...normalized].sort(compareStrings);
}

export function assertJsonSafe(value: unknown): void {
  if (value === null) return;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return;
  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw makeBundleError('E_BUNDLE_NON_JSON_SAFE', 'Artifact bundle contains non JSON-safe value');
    }
    return;
  }
  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
    throw makeBundleError('E_BUNDLE_NON_JSON_SAFE', 'Artifact bundle contains non JSON-safe value');
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      assertJsonSafe(entry);
    }
    return;
  }

  if (!isPlainObject(value)) {
    throw makeBundleError('E_BUNDLE_NON_JSON_SAFE', 'Artifact bundle contains non JSON-safe value');
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

function normalizeClosureContract(value: unknown): ClosureContractRefV1 {
  if (value === null || value === undefined) return null;
  if (
    !isPlainObject(value) ||
    value.schema !== 'closure-contract-1' ||
    typeof value.proposedHash !== 'string' ||
    typeof value.acceptedHash !== 'string'
  ) {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  return {
    schema: 'closure-contract-1',
    proposedHash: value.proposedHash,
    acceptedHash: value.acceptedHash,
  };
}

function normalizeTransferPackageV1(value: unknown): TransferPackageV1 {
  if (!isPlainObject(value) || value.schema !== 'transfer-package-1' || typeof value.transferHash !== 'string') {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  if (!isPlainObject(value.identity)) {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  if (
    typeof value.identity.packageId !== 'string' ||
    typeof value.identity.revisionId !== 'string' ||
    typeof value.identity.revisionHash !== 'string' ||
    !(typeof value.identity.parentRevisionId === 'string' || value.identity.parentRevisionId === null)
  ) {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  assertJsonSafe(value);
  return value as TransferPackageV1;
}

function normalizeLineageBindingV1(value: unknown): LineageBindingV1 {
  if (!isPlainObject(value) || value.schema !== 'lineage-binding-1' || typeof value.lineageHash !== 'string') {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  if (!(typeof value.createdAt === 'string' || value.createdAt === null)) {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  if (!isPlainObject(value.identity) || !isPlainObject(value.bindings) || !isPlainObject(value.diagnostics)) {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  if (
    typeof value.identity.packageId !== 'string' ||
    typeof value.identity.revisionId !== 'string' ||
    typeof value.identity.revisionHash !== 'string' ||
    !(typeof value.identity.parentRevisionId === 'string' || value.identity.parentRevisionId === null)
  ) {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  if (
    !isPlainObject(value.bindings.transfer) ||
    value.bindings.transfer.schema !== 'transfer-package-1' ||
    typeof value.bindings.transfer.transferHash !== 'string'
  ) {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  if (!(Array.isArray(value.diagnostics.missing) && Array.isArray(value.diagnostics.notes))) {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  assertJsonSafe(value);
  return value as LineageBindingV1;
}

function normalizeHandoffRecordV1(value: unknown): HandoffRecordV1 {
  if (!isPlainObject(value) || value.schema !== 'handoff-record-1' || typeof value.handoffHash !== 'string') {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  if (!(typeof value.createdAt === 'string' || value.createdAt === null)) {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  if (!isPlainObject(value.identity) || !isPlainObject(value.transfer) || !isPlainObject(value.lineageBindingV1)) {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  if (
    typeof value.identity.packageId !== 'string' ||
    typeof value.identity.revisionId !== 'string' ||
    typeof value.identity.revisionHash !== 'string' ||
    !(typeof value.identity.parentRevisionId === 'string' || value.identity.parentRevisionId === null)
  ) {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  if (value.transfer.schema !== 'transfer-package-1' || typeof value.transfer.transferHash !== 'string') {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  normalizeLineageBindingV1(value.lineageBindingV1);
  assertJsonSafe(value);
  return value as HandoffRecordV1;
}

function cloneTransferPackageV1(transferPackageV1: TransferPackageV1): TransferPackageV1 {
  return {
    schema: 'transfer-package-1',
    identity: {
      packageId: transferPackageV1.identity.packageId,
      revisionId: transferPackageV1.identity.revisionId,
      revisionHash: transferPackageV1.identity.revisionHash,
      parentRevisionId: transferPackageV1.identity.parentRevisionId,
    },
    bindings: {
      closureContractV1: transferPackageV1.bindings.closureContractV1
        ? {
            schema: 'closure-contract-1',
            proposedHash: transferPackageV1.bindings.closureContractV1.proposedHash,
            acceptedHash: transferPackageV1.bindings.closureContractV1.acceptedHash,
          }
        : null,
      applyReportV1Hash: transferPackageV1.bindings.applyReportV1Hash,
      executionRecordV1Hash: transferPackageV1.bindings.executionRecordV1Hash,
    },
    trunk: {
      intent: {
        primary: transferPackageV1.trunk.intent.primary,
        successCriteria: [...transferPackageV1.trunk.intent.successCriteria],
        nonGoals: [...transferPackageV1.trunk.intent.nonGoals],
      },
      stateDigest: {
        facts: [...transferPackageV1.trunk.stateDigest.facts],
        decisions: [...transferPackageV1.trunk.stateDigest.decisions],
        constraints: [...transferPackageV1.trunk.stateDigest.constraints],
        risks: [...transferPackageV1.trunk.stateDigest.risks],
        assumptions: [...transferPackageV1.trunk.stateDigest.assumptions],
        openLoops: [...transferPackageV1.trunk.stateDigest.openLoops],
      },
    },
    continuation: {
      nextActions: transferPackageV1.continuation.nextActions.map((entry) => ({
        code: entry.code,
        message: entry.message,
        expectedOutput: entry.expectedOutput,
        domains: [...entry.domains],
      })),
      validationChecklist: transferPackageV1.continuation.validationChecklist.map((entry) => ({
        code: entry.code,
        message: entry.message,
        severity: entry.severity,
      })),
    },
    conflicts: transferPackageV1.conflicts.map((entry) => ({
      domain: entry.domain,
      code: entry.code,
      key: entry.key,
      path: entry.path,
      message: entry.message,
    })),
    determinism: {
      sorted: true,
      domainOrder: ['facts', 'decisions', 'constraints', 'risks', 'assumptions'],
    },
    transferHash: transferPackageV1.transferHash,
  };
}

function cloneLineageBindingV1(lineageBindingV1: LineageBindingV1, createdAt: string | null): LineageBindingV1 {
  return {
    schema: 'lineage-binding-1',
    identity: {
      packageId: lineageBindingV1.identity.packageId,
      revisionId: lineageBindingV1.identity.revisionId,
      revisionHash: lineageBindingV1.identity.revisionHash,
      parentRevisionId: lineageBindingV1.identity.parentRevisionId,
    },
    bindings: {
      transfer: lineageBindingV1.bindings.transfer
        ? {
            schema: 'transfer-package-1',
            transferHash: lineageBindingV1.bindings.transfer.transferHash,
          }
        : null,
      closure: lineageBindingV1.bindings.closure
        ? {
            schema: 'closure-contract-1',
            proposedHash: lineageBindingV1.bindings.closure.proposedHash,
            acceptedHash: lineageBindingV1.bindings.closure.acceptedHash,
          }
        : null,
      execution: lineageBindingV1.bindings.execution
        ? {
            schema: 'execution-record-1',
            reportHash: lineageBindingV1.bindings.execution.reportHash,
            deltaHash: lineageBindingV1.bindings.execution.deltaHash,
          }
        : null,
      handoff: lineageBindingV1.bindings.handoff
        ? {
            schema: 'handoff-record-1',
            handoffHash: lineageBindingV1.bindings.handoff.handoffHash,
          }
        : null,
    },
    diagnostics: {
      missing: [...lineageBindingV1.diagnostics.missing],
      notes: [...lineageBindingV1.diagnostics.notes],
    },
    createdAt,
    lineageHash: lineageBindingV1.lineageHash,
  };
}

function cloneHandoffRecordV1(handoffRecordV1: HandoffRecordV1, createdAt: string | null, lineageCreatedAt: string | null): HandoffRecordV1 {
  return {
    schema: 'handoff-record-1',
    transfer: {
      schema: 'transfer-package-1',
      transferHash: handoffRecordV1.transfer.transferHash,
    },
    identity: {
      packageId: handoffRecordV1.identity.packageId,
      revisionId: handoffRecordV1.identity.revisionId,
      revisionHash: handoffRecordV1.identity.revisionHash,
      parentRevisionId: handoffRecordV1.identity.parentRevisionId,
    },
    bindings: {
      closureContractV1: handoffRecordV1.bindings.closureContractV1
        ? {
            schema: 'closure-contract-1',
            proposedHash: handoffRecordV1.bindings.closureContractV1.proposedHash,
            acceptedHash: handoffRecordV1.bindings.closureContractV1.acceptedHash,
          }
        : null,
      applyReportV1Hash: handoffRecordV1.bindings.applyReportV1Hash,
      executionRecordV1Hash: handoffRecordV1.bindings.executionRecordV1Hash,
    },
    trunk: {
      intent: {
        primary: handoffRecordV1.trunk.intent.primary,
        successCriteria: [...handoffRecordV1.trunk.intent.successCriteria],
        nonGoals: [...handoffRecordV1.trunk.intent.nonGoals],
      },
      stateDigest: {
        facts: [...handoffRecordV1.trunk.stateDigest.facts],
        decisions: [...handoffRecordV1.trunk.stateDigest.decisions],
        constraints: [...handoffRecordV1.trunk.stateDigest.constraints],
        risks: [...handoffRecordV1.trunk.stateDigest.risks],
        assumptions: [...handoffRecordV1.trunk.stateDigest.assumptions],
        openLoops: [...handoffRecordV1.trunk.stateDigest.openLoops],
      },
    },
    continuation: {
      nextActions: handoffRecordV1.continuation.nextActions.map((entry) => ({
        code: entry.code,
        message: entry.message,
        expectedOutput: entry.expectedOutput,
        domains: [...entry.domains],
      })),
      validationChecklist: handoffRecordV1.continuation.validationChecklist.map((entry) => ({
        code: entry.code,
        message: entry.message,
        severity: entry.severity,
      })),
    },
    diagnostics: {
      verified: true,
      verification: {
        transferHashRecomputed: handoffRecordV1.diagnostics.verification.transferHashRecomputed,
        matchesProvidedHash: handoffRecordV1.diagnostics.verification.matchesProvidedHash,
      },
    },
    lineageBindingV1: cloneLineageBindingV1(handoffRecordV1.lineageBindingV1, lineageCreatedAt),
    createdAt,
    handoffHash: handoffRecordV1.handoffHash,
  };
}

function buildInvariant(code: InvariantCode, ok: boolean): { code: string; ok: boolean; message: string } {
  if (code === 'INV_TRANSFER_HASH_MATCH_LINEAGE') {
    return {
      code,
      ok,
      message: ok ? 'Transfer hash matches lineage binding' : 'Transfer hash does not match lineage binding',
    };
  }
  if (code === 'INV_EMBEDDED_LINEAGE_HASH_MATCH_TOP') {
    return {
      code,
      ok,
      message: ok ? 'Embedded lineage hash matches top-level lineage' : 'Embedded lineage hash does not match top-level lineage',
    };
  }
  if (code === 'INV_NO_HANDOFF_BINDING_IN_LINEAGE') {
    return {
      code,
      ok,
      message: ok ? 'Lineage has no handoff binding' : 'Lineage has a handoff binding',
    };
  }
  return {
    code,
    ok,
    message: ok ? 'Artifact bundle is JSON-safe' : 'Artifact bundle is not JSON-safe',
  };
}

function buildCanonicalBundle(input: BuildArtifactBundleV1Input): Omit<ArtifactBundleV1, 'bundleHash'> {
  if (!isPlainObject(input) || !isPlainObject(input.identity) || !isPlainObject(input.artifacts)) {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }

  assertJsonSafe(input);

  if (typeof input.identity.packageId !== 'string') {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }

  const transferPackageV1 = cloneTransferPackageV1(normalizeTransferPackageV1(input.artifacts.transferPackageV1));
  const lineageBindingV1 = cloneLineageBindingV1(normalizeLineageBindingV1(input.artifacts.lineageBindingV1), normalizeNullableString((input.artifacts.lineageBindingV1 as LineageBindingV1).createdAt));
  const handoffRecordV1 = cloneHandoffRecordV1(
    normalizeHandoffRecordV1(input.artifacts.handoffRecordV1),
    normalizeNullableString((input.artifacts.handoffRecordV1 as HandoffRecordV1).createdAt),
    normalizeNullableString((input.artifacts.handoffRecordV1 as HandoffRecordV1).lineageBindingV1.createdAt)
  );
  const closureContractV1 = normalizeClosureContract(input.artifacts.closureContractV1);

  const invariants: Array<{ code: string; ok: boolean; message: string }> = [
    buildInvariant(
      'INV_TRANSFER_HASH_MATCH_LINEAGE',
      lineageBindingV1.bindings.transfer !== null &&
        lineageBindingV1.bindings.transfer.transferHash === transferPackageV1.transferHash
    ),
    buildInvariant(
      'INV_EMBEDDED_LINEAGE_HASH_MATCH_TOP',
      handoffRecordV1.lineageBindingV1.lineageHash === lineageBindingV1.lineageHash
    ),
    buildInvariant('INV_NO_HANDOFF_BINDING_IN_LINEAGE', lineageBindingV1.bindings.handoff === null),
    buildInvariant('INV_JSON_SAFE', true),
  ];

  const bundle: Omit<ArtifactBundleV1, 'bundleHash'> = {
    schema: 'artifact-bundle-1',
    identity: {
      packageId: input.identity.packageId,
      revisionId: normalizeNullableString(input.identity.revisionId),
      revisionHash: normalizeNullableString(input.identity.revisionHash),
    },
    artifacts: {
      transferPackageV1,
      lineageBindingV1,
      handoffRecordV1,
      closureContractV1,
    },
    diagnostics: {
      invariants,
      notes: normalizeStringArray(input.diagnostics?.notes),
    },
    createdAt: normalizeNullableString(input.createdAt),
  };

  assertJsonSafe(bundle);
  return bundle;
}

function canonicalizeBundleForHash(bundle: Omit<ArtifactBundleV1, 'bundleHash'> | ArtifactBundleV1): BundleHashPayload {
  return {
    schema: 'artifact-bundle-1',
    identity: {
      packageId: bundle.identity.packageId,
      revisionId: bundle.identity.revisionId,
      revisionHash: bundle.identity.revisionHash,
    },
    artifacts: {
      transferPackageV1: cloneTransferPackageV1(bundle.artifacts.transferPackageV1),
      lineageBindingV1: cloneLineageBindingV1(bundle.artifacts.lineageBindingV1, null),
      handoffRecordV1: cloneHandoffRecordV1(bundle.artifacts.handoffRecordV1, null, null),
      closureContractV1: bundle.artifacts.closureContractV1
        ? {
            schema: 'closure-contract-1',
            proposedHash: bundle.artifacts.closureContractV1.proposedHash,
            acceptedHash: bundle.artifacts.closureContractV1.acceptedHash,
          }
        : null,
    },
    diagnostics: {
      invariants: bundle.diagnostics.invariants.map((entry) => ({
        code: entry.code,
        ok: entry.ok,
        message: entry.message,
      })),
      notes: [...bundle.diagnostics.notes],
    },
  };
}

function normalizeInvariantArray(value: unknown): Array<{ code: string; ok: boolean; message: string }> {
  if (!Array.isArray(value) || value.length != INVARIANT_ORDER.length) {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  const normalized: Array<{ code: string; ok: boolean; message: string }> = [];
  for (let index = 0; index < INVARIANT_ORDER.length; index += 1) {
    const entry = value[index];
    if (!isPlainObject(entry)) {
      throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
    }
    const codeValue = entry.code;
    const okValue = entry.ok;
    const messageValue = entry.message;
    if (codeValue != INVARIANT_ORDER[index] || typeof okValue !== 'boolean' || typeof messageValue !== 'string') {
      throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
    }
    normalized.push({
      code: INVARIANT_ORDER[index],
      ok: okValue,
      message: messageValue,
    });
  }
  return normalized;
}

function normalizeArtifactBundleV1(bundle: unknown): ArtifactBundleV1 {
  if (!isPlainObject(bundle) || bundle.schema !== 'artifact-bundle-1' || typeof bundle.bundleHash !== 'string') {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  if (!isPlainObject(bundle.identity) || !isPlainObject(bundle.artifacts) || !isPlainObject(bundle.diagnostics)) {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }
  if (typeof bundle.identity.packageId !== 'string') {
    throw makeBundleError('E_BUNDLE_INVALID', 'Artifact bundle input is invalid');
  }

  const normalized: ArtifactBundleV1 = {
    schema: 'artifact-bundle-1',
    identity: {
      packageId: bundle.identity.packageId,
      revisionId: normalizeNullableString(bundle.identity.revisionId),
      revisionHash: normalizeNullableString(bundle.identity.revisionHash),
    },
    artifacts: {
      transferPackageV1: cloneTransferPackageV1(normalizeTransferPackageV1(bundle.artifacts.transferPackageV1)),
      lineageBindingV1: cloneLineageBindingV1(normalizeLineageBindingV1(bundle.artifacts.lineageBindingV1), normalizeNullableString((bundle.artifacts.lineageBindingV1 as LineageBindingV1).createdAt)),
      handoffRecordV1: cloneHandoffRecordV1(
        normalizeHandoffRecordV1(bundle.artifacts.handoffRecordV1),
        normalizeNullableString((bundle.artifacts.handoffRecordV1 as HandoffRecordV1).createdAt),
        normalizeNullableString((bundle.artifacts.handoffRecordV1 as HandoffRecordV1).lineageBindingV1.createdAt)
      ),
      closureContractV1: normalizeClosureContract(bundle.artifacts.closureContractV1),
    },
    diagnostics: {
      invariants: normalizeInvariantArray(bundle.diagnostics.invariants),
      notes: normalizeStringArray(bundle.diagnostics.notes),
    },
    createdAt: normalizeNullableString(bundle.createdAt),
    bundleHash: bundle.bundleHash,
  };

  assertJsonSafe(normalized);
  return normalized;
}

export function buildArtifactBundleV1(input: BuildArtifactBundleV1Input): ArtifactBundleV1 {
  const bundleWithoutHash = buildCanonicalBundle(input);
  const bundleHash = sha256Hex(stableStringify(canonicalizeBundleForHash(bundleWithoutHash)));
  const bundle: ArtifactBundleV1 = {
    ...bundleWithoutHash,
    bundleHash,
  };
  assertJsonSafe(bundle);
  return bundle;
}

export function recomputeArtifactBundleV1Hash(bundle: ArtifactBundleV1): string {
  const normalized = normalizeArtifactBundleV1(bundle);
  return sha256Hex(stableStringify(canonicalizeBundleForHash(normalized)));
}

export function verifyArtifactBundleV1(bundle: ArtifactBundleV1): { ok: true; recomputedHash: string; matches: boolean } {
  const normalized = normalizeArtifactBundleV1(bundle);
  const recomputedHash = sha256Hex(stableStringify(canonicalizeBundleForHash(normalized)));
  return {
    ok: true,
    recomputedHash,
    matches: recomputedHash === normalized.bundleHash,
  };
}

export function verifyArtifactBundleV1OrThrow(bundle: ArtifactBundleV1): void {
  const verification = verifyArtifactBundleV1(bundle);
  if (!verification.matches) {
    throw makeBundleError('E_BUNDLE_HASH_MISMATCH', 'Artifact bundle hash mismatch');
  }
}
