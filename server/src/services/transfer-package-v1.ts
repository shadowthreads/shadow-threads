import { createHash } from 'crypto';

export type DomainName = 'facts' | 'decisions' | 'constraints' | 'risks' | 'assumptions';

export const DOMAIN_ORDER: readonly DomainName[] = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];

export type TransferPackageV1 = {
  schema: 'transfer-package-1';
  identity: {
    packageId: string;
    revisionId: string;
    revisionHash: string;
    parentRevisionId: string | null;
  };
  bindings: {
    closureContractV1: {
      schema: 'closure-contract-1';
      proposedHash: string;
      acceptedHash: string;
    } | null;
    applyReportV1Hash: string | null;
    executionRecordV1Hash: string | null;
  };
  trunk: {
    intent: {
      primary: string | null;
      successCriteria: string[];
      nonGoals: string[];
    };
    stateDigest: {
      facts: string[];
      decisions: string[];
      constraints: string[];
      risks: string[];
      assumptions: string[];
      openLoops: string[];
    };
  };
  continuation: {
    nextActions: Array<{
      code: string;
      message: string;
      expectedOutput: string | null;
      domains: DomainName[];
    }>;
    validationChecklist: Array<{
      code: string;
      message: string;
      severity: 'must' | 'should';
    }>;
  };
  conflicts: Array<{
    domain: string;
    code: string;
    key: string | null;
    path: string | null;
    message: string;
  }>;
  determinism: {
    sorted: true;
    domainOrder: ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];
  };
  transferHash: string;
};

export type TransferClosureBindingInput = {
  schema: 'closure-contract-1';
  proposedHash: string;
  acceptedHash: string;
} | null;

export type BuildTransferPackageV1Input = {
  identity: {
    packageId: string;
    revisionId: string;
    revisionHash: string;
    parentRevisionId?: string | null;
  };
  bindings?: {
    closureContractV1?: TransferClosureBindingInput;
    applyReportV1Hash?: string | null;
    executionRecordV1Hash?: string | null;
  };
  trunk?: {
    intent?: {
      primary?: string | null;
      successCriteria?: string[];
      nonGoals?: string[];
    };
    stateDigest?: Partial<Record<DomainName | 'openLoops', string[]>>;
  };
  continuation?: {
    nextActions?: Array<{
      code: string;
      message: string;
      expectedOutput?: string | null;
      domains?: DomainName[];
    }>;
    validationChecklist?: Array<{
      code: string;
      message: string;
      severity?: 'must' | 'should';
    }>;
  };
  conflicts?: Array<{
    domain: string;
    code: string;
    key?: string | null;
    path?: string | null;
    message: string;
  }>;
};

type NextActionInput = {
  code: string;
  message: string;
  expectedOutput?: string | null;
  domains?: DomainName[];
};

type ValidationChecklistInput = {
  code: string;
  message: string;
  severity?: 'must' | 'should';
};

function makeTransferError(code: 'E_TRANSFER_INVALID' | 'E_TRANSFER_NON_JSON_SAFE' | 'E_TRANSFER_HASH_MISMATCH', message: string): Error & { code: string } {
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

function normalizeStringArray(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value.filter((entry): entry is string => typeof entry === 'string');
  return [...normalized].sort(compareStrings);
}

function normalizeDomains(value: DomainName[] | undefined): DomainName[] {
  if (!Array.isArray(value)) return [];
  const normalized = value.filter((entry): entry is DomainName => isDomainName(entry));
  return [...normalized].sort(compareDomains);
}


export function assertJsonSafe(value: unknown): void {
  if (value === null) return;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return;
  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw makeTransferError('E_TRANSFER_NON_JSON_SAFE', 'Transfer package contains non JSON-safe value');
    }
    return;
  }
  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
    throw makeTransferError('E_TRANSFER_NON_JSON_SAFE', 'Transfer package contains non JSON-safe value');
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      assertJsonSafe(entry);
    }
    return;
  }

  if (!isPlainObject(value)) {
    throw makeTransferError('E_TRANSFER_NON_JSON_SAFE', 'Transfer package contains non JSON-safe value');
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

function normalizeClosureBinding(value: TransferClosureBindingInput | undefined): TransferPackageV1['bindings']['closureContractV1'] {
  if (value === null || value === undefined) return null;
  if (
    value.schema !== 'closure-contract-1' ||
    typeof value.proposedHash !== 'string' ||
    typeof value.acceptedHash !== 'string'
  ) {
    throw makeTransferError('E_TRANSFER_INVALID', 'Transfer package input is invalid');
  }
  return {
    schema: 'closure-contract-1',
    proposedHash: value.proposedHash,
    acceptedHash: value.acceptedHash,
  };
}

function normalizeNextActions(
  value: NextActionInput[] | undefined
): TransferPackageV1['continuation']['nextActions'] {
  if (!Array.isArray(value)) return [];

  const normalized = value.map((entry) => {
    if (!entry || typeof entry.code !== 'string' || typeof entry.message !== 'string') {
      throw makeTransferError('E_TRANSFER_INVALID', 'Transfer package input is invalid');
    }

    const domains = normalizeDomains(entry.domains);
    return {
      code: entry.code,
      message: entry.message,
      expectedOutput: typeof entry.expectedOutput === 'string' ? entry.expectedOutput : entry.expectedOutput === null ? null : null,
      domains,
    };
  });

  return normalized.sort((left, right) => {
    const leftDomains = left.domains.join('|');
    const rightDomains = right.domains.join('|');
    return (
      compareStrings(left.code, right.code) ||
      compareStrings(left.message, right.message) ||
      compareStrings(left.expectedOutput ?? 'NULL', right.expectedOutput ?? 'NULL') ||
      compareStrings(leftDomains, rightDomains)
    );
  });
}

function normalizeValidationChecklist(
  value: ValidationChecklistInput[] | undefined
): TransferPackageV1['continuation']['validationChecklist'] {
  if (!Array.isArray(value)) return [];

  const normalized = value.map((entry) => {
    if (!entry || typeof entry.code !== 'string' || typeof entry.message !== 'string') {
      throw makeTransferError('E_TRANSFER_INVALID', 'Transfer package input is invalid');
    }
    const severity: 'must' | 'should' = entry.severity === 'must' ? 'must' : 'should';
    return {
      code: entry.code,
      message: entry.message,
      severity,
    };
  });

  return normalized.sort((left, right) => {
    return (
      compareStrings(left.severity, right.severity) ||
      compareStrings(left.code, right.code) ||
      compareStrings(left.message, right.message)
    );
  });
}

function normalizeConflicts(value: BuildTransferPackageV1Input['conflicts']): TransferPackageV1['conflicts'] {
  if (!Array.isArray(value)) return [];

  const normalized = value.map((entry) => {
    if (!entry || typeof entry.domain !== 'string' || typeof entry.code !== 'string' || typeof entry.message !== 'string') {
      throw makeTransferError('E_TRANSFER_INVALID', 'Transfer package input is invalid');
    }
    return {
      domain: entry.domain,
      code: entry.code,
      key: typeof entry.key === 'string' ? entry.key : entry.key === null ? null : null,
      path: typeof entry.path === 'string' ? entry.path : entry.path === null ? null : null,
      message: entry.message,
    };
  });

  return normalized.sort((left, right) => {
    return (
      compareStrings(left.domain, right.domain) ||
      compareStrings(left.code, right.code) ||
      compareStrings(left.key ?? 'NULL', right.key ?? 'NULL') ||
      compareStrings(left.path ?? 'NULL', right.path ?? 'NULL') ||
      compareStrings(left.message, right.message)
    );
  });
}

export function buildTransferPackageV1(input: BuildTransferPackageV1Input): TransferPackageV1 {
  if (!input || !input.identity) {
    throw makeTransferError('E_TRANSFER_INVALID', 'Transfer package input is invalid');
  }

  assertJsonSafe(input);

  const { identity } = input;
  if (
    typeof identity.packageId !== 'string' ||
    typeof identity.revisionId !== 'string' ||
    typeof identity.revisionHash !== 'string'
  ) {
    throw makeTransferError('E_TRANSFER_INVALID', 'Transfer package input is invalid');
  }

  const stateDigestInput = input.trunk?.stateDigest ?? {};
  const nextActions = normalizeNextActions(input.continuation?.nextActions);
  const validationChecklist = normalizeValidationChecklist(input.continuation?.validationChecklist);
  const conflicts = normalizeConflicts(input.conflicts);

  const contractWithoutHash = {
    schema: 'transfer-package-1' as const,
    identity: {
      packageId: identity.packageId,
      revisionId: identity.revisionId,
      revisionHash: identity.revisionHash,
      parentRevisionId: typeof identity.parentRevisionId === 'string' ? identity.parentRevisionId : identity.parentRevisionId === null ? null : null,
    },
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
        primary:
          typeof input.trunk?.intent?.primary === 'string'
            ? input.trunk.intent.primary
            : input.trunk?.intent?.primary === null
            ? null
            : null,
        successCriteria: normalizeStringArray(input.trunk?.intent?.successCriteria),
        nonGoals: normalizeStringArray(input.trunk?.intent?.nonGoals),
      },
      stateDigest: {
        facts: normalizeStringArray(stateDigestInput.facts),
        decisions: normalizeStringArray(stateDigestInput.decisions),
        constraints: normalizeStringArray(stateDigestInput.constraints),
        risks: normalizeStringArray(stateDigestInput.risks),
        assumptions: normalizeStringArray(stateDigestInput.assumptions),
        openLoops: normalizeStringArray(stateDigestInput.openLoops),
      },
    },
    continuation: {
      nextActions,
      validationChecklist,
    },
    conflicts,
    determinism: {
      sorted: true as const,
      domainOrder: ['facts', 'decisions', 'constraints', 'risks', 'assumptions'] as ['facts', 'decisions', 'constraints', 'risks', 'assumptions'],
    },
  };

  assertJsonSafe(contractWithoutHash);
  const transferHash = sha256Hex(stableStringify(contractWithoutHash));
  const contract: TransferPackageV1 = {
    ...contractWithoutHash,
    transferHash,
  };

  assertJsonSafe(contract);
  return contract;
}


export function recomputeTransferPackageV1Hash(input: TransferPackageV1): string {
  if (!input || input.schema !== 'transfer-package-1' || typeof input.transferHash !== 'string') {
    throw makeTransferError('E_TRANSFER_INVALID', 'Transfer package input is invalid');
  }

  assertJsonSafe(input);

  const rebuilt = buildTransferPackageV1({
    identity: {
      packageId: input.identity.packageId,
      revisionId: input.identity.revisionId,
      revisionHash: input.identity.revisionHash,
      parentRevisionId: input.identity.parentRevisionId,
    },
    bindings: {
      closureContractV1: input.bindings.closureContractV1,
      applyReportV1Hash: input.bindings.applyReportV1Hash,
      executionRecordV1Hash: input.bindings.executionRecordV1Hash,
    },
    trunk: {
      intent: {
        primary: input.trunk.intent.primary,
        successCriteria: [...input.trunk.intent.successCriteria],
        nonGoals: [...input.trunk.intent.nonGoals],
      },
      stateDigest: {
        facts: [...input.trunk.stateDigest.facts],
        decisions: [...input.trunk.stateDigest.decisions],
        constraints: [...input.trunk.stateDigest.constraints],
        risks: [...input.trunk.stateDigest.risks],
        assumptions: [...input.trunk.stateDigest.assumptions],
        openLoops: [...input.trunk.stateDigest.openLoops],
      },
    },
    continuation: {
      nextActions: input.continuation.nextActions.map((entry) => ({
        code: entry.code,
        message: entry.message,
        expectedOutput: entry.expectedOutput,
        domains: [...entry.domains],
      })),
      validationChecklist: input.continuation.validationChecklist.map((entry) => ({
        code: entry.code,
        message: entry.message,
        severity: entry.severity,
      })),
    },
    conflicts: input.conflicts.map((entry) => ({
      domain: entry.domain,
      code: entry.code,
      key: entry.key,
      path: entry.path,
      message: entry.message,
    })),
  });

  return rebuilt.transferHash;
}

export function verifyTransferPackageV1(input: TransferPackageV1): { ok: true; recomputedHash: string } {
  const recomputedHash = recomputeTransferPackageV1Hash(input);

  if (recomputedHash != input.transferHash) {
    throw makeTransferError('E_TRANSFER_HASH_MISMATCH', 'Transfer package hash mismatch');
  }

  return { ok: true, recomputedHash };
}
