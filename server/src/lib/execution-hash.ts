import { createHash } from 'crypto';
import { canonicalizeJson } from './artifact-hash';

export type ExecutionArtifactReference = {
  bundleHash: string;
  role: string;
};

export type ExecutionStatus = 'success' | 'failure';

export type ComputeExecutionResultHashInput = {
  outputs: ExecutionArtifactReference[];
  status: ExecutionStatus;
};

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeOutputs(outputs: ExecutionArtifactReference[]): ExecutionArtifactReference[] {
  const normalized = outputs.map((output) => ({
    bundleHash: output.bundleHash,
    role: output.role,
  }));

  // Deterministic ordering rule:
  // sort outputs by bundleHash ASC, role ASC
  normalized.sort((a, b) => {
    const bundleOrder = compareStrings(a.bundleHash, b.bundleHash);
    if (bundleOrder !== 0) {
      return bundleOrder;
    }
    return compareStrings(a.role, b.role);
  });

  return normalized;
}

export function computeExecutionResultHash(input: ComputeExecutionResultHashInput): string {
  const hashPayload = {
    outputs: normalizeOutputs(input.outputs),
    status: input.status,
  };

  const canonical = canonicalizeJson(hashPayload);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
