export class IdentityGuardError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'IdentityGuardError';
  }
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key);
}

export function assertSafeObjectKey(key: string): void {
  if (isDangerousKey(key)) {
    throw new IdentityGuardError('ERR_INVALID_OBJECT_KEY');
  }
}

export function assertHashMatch(providedHash: string | undefined, computedHash: string): string {
  if (typeof providedHash !== 'undefined' && providedHash !== computedHash) {
    throw new IdentityGuardError('ERR_ARTIFACT_HASH_MISMATCH');
  }

  return computedHash;
}
