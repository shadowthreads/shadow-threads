import { createHash } from 'crypto';
import { DOMAIN_ORDER, type DomainName, type TransferClosureBindingInput, type TransferPackageV1 } from './transfer-package-v1';
import type { LineageBindingV1 } from './lineage-binding-v1';

export type HandoffRecordV1 = {
  schema: 'handoff-record-1';
  transfer: {
    schema: 'transfer-package-1';
    transferHash: string;
  };
  identity: {
    packageId: string;
    revisionId: string;
    revisionHash: string;
    parentRevisionId: string | null;
  };
  bindings: {
    closureContractV1: { schema: 'closure-contract-1'; proposedHash: string; acceptedHash: string } | null;
    applyReportV1Hash: string | null;
    executionRecordV1Hash: string | null;
  };
  trunk: TransferPackageV1['trunk'];
  continuation: TransferPackageV1['continuation'];
  diagnostics: {
    verified: true;
    verification: {
      transferHashRecomputed: string;
      matchesProvidedHash: boolean;
    };
  };
  lineageBindingV1: LineageBindingV1;
  createdAt: string | null;
  handoffHash: string;
};

export type BuildHandoffRecordV1Input = {
  transferPackageV1: TransferPackageV1;
  verification: {
    transferHashRecomputed: string;
    matchesProvidedHash: boolean;
  };
  bindings?: {
    closureContractV1?: TransferClosureBindingInput;
    applyReportV1Hash?: string | null;
    executionRecordV1Hash?: string | null;
  };
  lineageBindingV1: LineageBindingV1;
  createdAt?: string | null;
};

type HandoffHashPayload = Omit<HandoffRecordV1, 'createdAt' | 'handoffHash'>;

const LINEAGE_MISSING_KEYS = ['transfer', 'closure', 'execution', 'handoff'] as const;
type LineageMissingKey = (typeof LINEAGE_MISSING_KEYS)[number];

function makeHandoffError(
  code: 'E_HANDOFF_INVALID' | 'E_HANDOFF_NON_JSON_SAFE' | 'E_HANDOFF_HASH_MISMATCH',
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

function compareDomains(a: DomainName, b: DomainName): number {
  const leftIndex = DOMAIN_ORDER.indexOf(a);
  const rightIndex = DOMAIN_ORDER.indexOf(b);
  if (leftIndex < rightIndex) return -1;
  if (leftIndex > rightIndex) return 1;
  return compareStrings(a, b);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isDomainName(value: unknown): value is DomainName {
  return value === 'facts' || value === 'decisions' || value === 'constraints' || value === 'risks' || value === 'assumptions';
}

function isLineageMissingKey(value: unknown): value is LineageMissingKey {
  return value === 'transfer' || value === 'closure' || value === 'execution' || value === 'handoff';
}

export function assertJsonSafe(value: unknown): void {
  if (value === null) return;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return;
  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw makeHandoffError('E_HANDOFF_NON_JSON_SAFE', 'Handoff record contains non JSON-safe value');
    }
    return;
  }
  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
    throw makeHandoffError('E_HANDOFF_NON_JSON_SAFE', 'Handoff record contains non JSON-safe value');
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      assertJsonSafe(entry);
    }
    return;
  }

  if (!isPlainObject(value)) {
    throw makeHandoffError('E_HANDOFF_NON_JSON_SAFE', 'Handoff record contains non JSON-safe value');
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

export function sha256Hex(str: string): string {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

function normalizeClosureBinding(value: unknown): HandoffRecordV1['bindings']['closureContractV1'] {
  if (value === null || value === undefined) return null;
  if (
    !isPlainObject(value) ||
    value.schema !== 'closure-contract-1' ||
    typeof value.proposedHash !== 'string' ||
    typeof value.acceptedHash !== 'string'
  ) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  return {
    schema: 'closure-contract-1',
    proposedHash: value.proposedHash,
    acceptedHash: value.acceptedHash,
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
    }
    normalized.push(entry);
  }
  return normalized;
}

function normalizeDomains(domains: unknown): DomainName[] {
  if (!Array.isArray(domains)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  const normalized: DomainName[] = [];
  for (const entry of domains) {
    if (!isDomainName(entry)) {
      throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
    }
    normalized.push(entry);
  }
  return [...normalized].sort(compareDomains);
}

function normalizeNextActions(nextActions: unknown): HandoffRecordV1['continuation']['nextActions'] {
  if (!Array.isArray(nextActions)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }

  return [...nextActions]
    .map((entry) => {
      if (!isPlainObject(entry) || typeof entry.code !== 'string' || typeof entry.message !== 'string') {
        throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
      }
      const expectedOutput =
        typeof entry.expectedOutput === 'string' ? entry.expectedOutput : entry.expectedOutput === null ? null : null;
      return {
        code: entry.code,
        message: entry.message,
        expectedOutput,
        domains: normalizeDomains(entry.domains),
      };
    })
    .sort((left, right) => {
      const leftDomains = left.domains.join('|');
      const rightDomains = right.domains.join('|');
      return (
        compareStrings(left.code, right.code) ||
        compareStrings(left.message, right.message) ||
        compareStrings(left.expectedOutput ?? '', right.expectedOutput ?? '') ||
        compareStrings(leftDomains, rightDomains)
      );
    });
}

function normalizeValidationChecklist(checklist: unknown): HandoffRecordV1['continuation']['validationChecklist'] {
  if (!Array.isArray(checklist)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }

  return [...checklist]
    .map((entry) => {
      if (!isPlainObject(entry) || typeof entry.code !== 'string' || typeof entry.message !== 'string') {
        throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
      }
      if (entry.severity !== 'must' && entry.severity !== 'should') {
        throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
      }
      const severity: 'must' | 'should' = entry.severity;
      return {
        code: entry.code,
        message: entry.message,
        severity,
      };
    })
    .sort((left, right) => {
      return (
        compareStrings(left.severity, right.severity) ||
        compareStrings(left.code, right.code) ||
        compareStrings(left.message, right.message)
      );
    });
}

function normalizeIdentity(value: unknown): HandoffRecordV1['identity'] {
  if (!isPlainObject(value)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  if (
    typeof value.packageId !== 'string' ||
    typeof value.revisionId !== 'string' ||
    typeof value.revisionHash !== 'string' ||
    !(typeof value.parentRevisionId === 'string' || value.parentRevisionId === null)
  ) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  return {
    packageId: value.packageId,
    revisionId: value.revisionId,
    revisionHash: value.revisionHash,
    parentRevisionId: value.parentRevisionId,
  };
}

function normalizeTransfer(value: unknown): HandoffRecordV1['transfer'] {
  if (!isPlainObject(value) || value.schema !== 'transfer-package-1' || typeof value.transferHash !== 'string') {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  return {
    schema: 'transfer-package-1',
    transferHash: value.transferHash,
  };
}

function normalizeBindings(value: unknown): HandoffRecordV1['bindings'] {
  if (value === undefined) {
    return {
      closureContractV1: null,
      applyReportV1Hash: null,
      executionRecordV1Hash: null,
    };
  }
  if (!isPlainObject(value)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  return {
    closureContractV1: normalizeClosureBinding(value.closureContractV1),
    applyReportV1Hash:
      typeof value.applyReportV1Hash === 'string' ? value.applyReportV1Hash : value.applyReportV1Hash === null ? null : null,
    executionRecordV1Hash:
      typeof value.executionRecordV1Hash === 'string'
        ? value.executionRecordV1Hash
        : value.executionRecordV1Hash === null
        ? null
        : null,
  };
}

function normalizeDiagnostics(value: unknown): HandoffRecordV1['diagnostics'] {
  if (!isPlainObject(value) || value.verified !== true || !isPlainObject(value.verification)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  if (
    typeof value.verification.transferHashRecomputed !== 'string' ||
    typeof value.verification.matchesProvidedHash !== 'boolean'
  ) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  return {
    verified: true,
    verification: {
      transferHashRecomputed: value.verification.transferHashRecomputed,
      matchesProvidedHash: value.verification.matchesProvidedHash,
    },
  };
}

function normalizeLineageMissing(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  const normalized: string[] = [];
  for (const entry of value) {
    if (!isLineageMissingKey(entry)) {
      throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
    }
    normalized.push(entry);
  }
  return normalized;
}

function normalizeLineageNotes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
    }
    normalized.push(entry);
  }
  return normalized;
}

function normalizeEmbeddedLineage(
  value: unknown,
  expectedIdentity: HandoffRecordV1['identity'],
  expectedTransferHash: string,
  enforceTransferHashMatch: boolean
): LineageBindingV1 {
  if (!isPlainObject(value) || value.schema !== 'lineage-binding-1') {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  if (typeof value.lineageHash !== 'string') {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  if (!(typeof value.createdAt === 'string' || value.createdAt === null)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }

  const identity = normalizeIdentity(value.identity);
  if (
    identity.packageId !== expectedIdentity.packageId ||
    identity.revisionId !== expectedIdentity.revisionId ||
    identity.revisionHash !== expectedIdentity.revisionHash ||
    identity.parentRevisionId !== expectedIdentity.parentRevisionId
  ) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }

  if (!isPlainObject(value.bindings)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  const transferBinding = normalizeTransfer(value.bindings.transfer);
  if (enforceTransferHashMatch && transferBinding.transferHash !== expectedTransferHash) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  if (!(value.bindings.handoff === null || value.bindings.handoff === undefined)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }

  if (!isPlainObject(value.diagnostics)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }

  return {
    schema: 'lineage-binding-1',
    identity,
    bindings: {
      transfer: transferBinding,
      closure: normalizeClosureBinding(value.bindings.closure) as LineageBindingV1['bindings']['closure'],
      execution:
        value.bindings.execution === null || value.bindings.execution === undefined
          ? null
          : (() => {
              if (!isPlainObject(value.bindings.execution) || value.bindings.execution.schema !== 'execution-record-1') {
                throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
              }
              if (
                !(
                  typeof value.bindings.execution.reportHash === 'string' ||
                  value.bindings.execution.reportHash === null ||
                  value.bindings.execution.reportHash === undefined
                ) ||
                !(
                  typeof value.bindings.execution.deltaHash === 'string' ||
                  value.bindings.execution.deltaHash === null ||
                  value.bindings.execution.deltaHash === undefined
                )
              ) {
                throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
              }
              return {
                schema: 'execution-record-1',
                reportHash:
                  typeof value.bindings.execution.reportHash === 'string' ? value.bindings.execution.reportHash : null,
                deltaHash:
                  typeof value.bindings.execution.deltaHash === 'string' ? value.bindings.execution.deltaHash : null,
              };
            })(),
      handoff: null,
    },
    diagnostics: {
      missing: normalizeLineageMissing(value.diagnostics.missing),
      notes: normalizeLineageNotes(value.diagnostics.notes),
    },
    createdAt: value.createdAt,
    lineageHash: value.lineageHash,
  };
}

function canonicalizeLineageForHash(lineageBindingV1: LineageBindingV1): LineageBindingV1 {
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
      handoff: null,
    },
    diagnostics: {
      missing: [...lineageBindingV1.diagnostics.missing],
      notes: [...lineageBindingV1.diagnostics.notes],
    },
    createdAt: null,
    lineageHash: lineageBindingV1.lineageHash,
  };
}

function buildCanonicalPayloadFromTransfer(input: BuildHandoffRecordV1Input): {
  payload: HandoffHashPayload;
  lineageBindingV1: LineageBindingV1;
} {
  if (
    !input ||
    !input.transferPackageV1 ||
    !input.verification ||
    typeof input.verification.transferHashRecomputed !== 'string' ||
    typeof input.verification.matchesProvidedHash !== 'boolean'
  ) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }

  assertJsonSafe(input);

  const transfer = input.transferPackageV1;
  if (transfer.schema !== 'transfer-package-1') {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }

  const identity = {
    packageId: transfer.identity.packageId,
    revisionId: transfer.identity.revisionId,
    revisionHash: transfer.identity.revisionHash,
    parentRevisionId: transfer.identity.parentRevisionId ?? null,
  };

  const lineageBindingV1 = normalizeEmbeddedLineage(input.lineageBindingV1, identity, transfer.transferHash, true);
  const payload: HandoffHashPayload = {
    schema: 'handoff-record-1',
    transfer: {
      schema: 'transfer-package-1',
      transferHash: transfer.transferHash,
    },
    identity,
    bindings: {
      closureContractV1: normalizeClosureBinding(input.bindings?.closureContractV1),
      applyReportV1Hash:
        typeof input.bindings?.applyReportV1Hash === 'string'
          ? input.bindings.applyReportV1Hash
          : input.bindings?.applyReportV1Hash === null
          ? null
          : null,
      executionRecordV1Hash:
        typeof input.bindings?.executionRecordV1Hash === 'string'
          ? input.bindings.executionRecordV1Hash
          : input.bindings?.executionRecordV1Hash === null
          ? null
          : null,
    },
    trunk: {
      intent: {
        primary: transfer.trunk.intent.primary ?? null,
        successCriteria: [...transfer.trunk.intent.successCriteria],
        nonGoals: [...transfer.trunk.intent.nonGoals],
      },
      stateDigest: {
        facts: [...transfer.trunk.stateDigest.facts],
        decisions: [...transfer.trunk.stateDigest.decisions],
        constraints: [...transfer.trunk.stateDigest.constraints],
        risks: [...transfer.trunk.stateDigest.risks],
        assumptions: [...transfer.trunk.stateDigest.assumptions],
        openLoops: [...transfer.trunk.stateDigest.openLoops],
      },
    },
    continuation: {
      nextActions: normalizeNextActions(transfer.continuation.nextActions),
      validationChecklist: normalizeValidationChecklist(transfer.continuation.validationChecklist),
    },
    diagnostics: {
      verified: true,
      verification: {
        transferHashRecomputed: input.verification.transferHashRecomputed,
        matchesProvidedHash: input.verification.matchesProvidedHash,
      },
    },
    lineageBindingV1: canonicalizeLineageForHash(lineageBindingV1),
  };

  return { payload, lineageBindingV1 };
}

function buildCanonicalPayloadFromRecord(handoffRecordV1: unknown): {
  payload: HandoffHashPayload;
  createdAt: string | null;
  handoffHash: string;
  lineageBindingV1: LineageBindingV1;
} {
  if (!isPlainObject(handoffRecordV1) || handoffRecordV1.schema !== 'handoff-record-1') {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  if (!(typeof handoffRecordV1.createdAt === 'string' || handoffRecordV1.createdAt === null)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  if (typeof handoffRecordV1.handoffHash !== 'string') {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }

  assertJsonSafe(handoffRecordV1);

  const transfer = normalizeTransfer(handoffRecordV1.transfer);
  const identity = normalizeIdentity(handoffRecordV1.identity);
  const bindings = normalizeBindings(handoffRecordV1.bindings);
  const diagnostics = normalizeDiagnostics(handoffRecordV1.diagnostics);

  const trunkValue = handoffRecordV1.trunk;
  if (!isPlainObject(trunkValue) || !isPlainObject(trunkValue.intent) || !isPlainObject(trunkValue.stateDigest)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  const trunk: HandoffRecordV1['trunk'] = {
    intent: {
      primary:
        typeof trunkValue.intent.primary === 'string'
          ? trunkValue.intent.primary
          : trunkValue.intent.primary === null
          ? null
          : null,
      successCriteria: normalizeStringArray(trunkValue.intent.successCriteria),
      nonGoals: normalizeStringArray(trunkValue.intent.nonGoals),
    },
    stateDigest: {
      facts: normalizeStringArray(trunkValue.stateDigest.facts),
      decisions: normalizeStringArray(trunkValue.stateDigest.decisions),
      constraints: normalizeStringArray(trunkValue.stateDigest.constraints),
      risks: normalizeStringArray(trunkValue.stateDigest.risks),
      assumptions: normalizeStringArray(trunkValue.stateDigest.assumptions),
      openLoops: normalizeStringArray(trunkValue.stateDigest.openLoops),
    },
  };

  const continuationValue = handoffRecordV1.continuation;
  if (!isPlainObject(continuationValue)) {
    throw makeHandoffError('E_HANDOFF_INVALID', 'Handoff record input is invalid');
  }
  const continuation: HandoffRecordV1['continuation'] = {
    nextActions: normalizeNextActions(continuationValue.nextActions),
    validationChecklist: normalizeValidationChecklist(continuationValue.validationChecklist),
  };

  const lineageBindingV1 = normalizeEmbeddedLineage(handoffRecordV1.lineageBindingV1, identity, transfer.transferHash, false);
  const payload: HandoffHashPayload = {
    schema: 'handoff-record-1',
    transfer,
    identity,
    bindings,
    trunk,
    continuation,
    diagnostics,
    lineageBindingV1: canonicalizeLineageForHash(lineageBindingV1),
  };

  return {
    payload,
    createdAt: handoffRecordV1.createdAt,
    handoffHash: handoffRecordV1.handoffHash,
    lineageBindingV1,
  };
}

export function buildHandoffRecordV1(input: BuildHandoffRecordV1Input): HandoffRecordV1 {
  const canonical = buildCanonicalPayloadFromTransfer(input);
  assertJsonSafe(canonical.payload);

  const handoffHash = sha256Hex(stableStringify(canonical.payload));
  const handoffRecord: HandoffRecordV1 = {
    ...canonical.payload,
    lineageBindingV1: canonical.lineageBindingV1,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : input.createdAt === null ? null : null,
    handoffHash,
  };

  assertJsonSafe(handoffRecord);
  return handoffRecord;
}

export function recomputeHandoffRecordV1Hash(handoffRecordV1: HandoffRecordV1): string {
  const canonical = buildCanonicalPayloadFromRecord(handoffRecordV1);
  return sha256Hex(stableStringify(canonical.payload));
}

export function verifyHandoffRecordV1(
  handoffRecordV1: HandoffRecordV1
): { ok: true; recomputedHash: string; matches: boolean } {
  const canonical = buildCanonicalPayloadFromRecord(handoffRecordV1);
  const recomputedHash = sha256Hex(stableStringify(canonical.payload));
  return {
    ok: true,
    recomputedHash,
    matches: recomputedHash === canonical.handoffHash,
  };
}

export function verifyHandoffRecordV1OrThrow(handoffRecordV1: HandoffRecordV1): void {
  const verification = verifyHandoffRecordV1(handoffRecordV1);
  if (!verification.matches) {
    throw makeHandoffError('E_HANDOFF_HASH_MISMATCH', 'Handoff record hash mismatch');
  }
}
