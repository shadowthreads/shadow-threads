export type ApplyMode = 'bootstrap' | 'constrain' | 'review';

export type NormalizedTaskPackage = {
  manifest: {
    schemaVersion: 'tpkg-0.2';
    packageId?: string;
    createdAt: string;
    updatedAt: string;
    title: string;
    description?: string;
    capabilities: {
      applyModes: ApplyMode[];
      conflictHandling: 'report_only';
    };
  };
  intent: {
    primary: string;
    successCriteria: string[];
    nonGoals: string[];
  };
  state: {
    facts: string[];
    decisions: string[];
    assumptions: string[];
    openLoops: string[];
  };
  constraints: {
    technical: string[];
    process: string[];
    policy: string[];
  };
  interfaces: {
    apis: Array<{
      name: string;
      type: 'http' | 'function' | 'cli' | 'other';
      contract: string;
    }>;
    modules: string[];
  };
  risks: Array<{
    id: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
    mitigation?: string;
  }>;
  evidence: Array<{
    type: 'snapshot' | 'selection' | 'delta' | 'external';
    sourceId: string;
    summary: string;
  }>;
  history: {
    origin: 'snapshot' | 'import' | 'manual';
    derivedFrom?: string;
    revision: number;
  };
  compat: {
    accepts: string[];
    downgradeStrategy: 'lossy-allowed';
  };
};

export type NormalizeFindings = {
  missingFields: string[];
  liftedFromVersion: string;
};

type NormalizeOptions = {
  revision: number;
  sourceSnapshotId?: string | null;
};

function getPath(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function hasString(obj: any, path: string): boolean {
  const v = getPath(obj, path);
  return typeof v === 'string' && v.trim().length > 0;
}

function hasArray(obj: any, path: string): boolean {
  const v = getPath(obj, path);
  return Array.isArray(v);
}

function hasNumber(obj: any, path: string): boolean {
  const v = getPath(obj, path);
  return typeof v === 'number' && Number.isFinite(v);
}

function asString(value: any): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === 'string');
}

function asApiArray(value: any): NormalizedTaskPackage['interfaces']['apis'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      name: asString(item?.name),
      type: asString(item?.type) as 'http' | 'function' | 'cli' | 'other',
      contract: asString(item?.contract),
    }))
    .filter((item) => item.name && item.type && item.contract);
}

function asRiskArray(value: any): NormalizedTaskPackage['risks'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      id: asString(item?.id),
      description: asString(item?.description),
      severity: asString(item?.severity) as 'low' | 'medium' | 'high',
      mitigation: typeof item?.mitigation === 'string' ? item.mitigation : undefined,
    }))
    .filter((item) => item.id && item.description && (item.severity === 'low' || item.severity === 'medium' || item.severity === 'high'));
}

function asEvidenceArray(value: any): NormalizedTaskPackage['evidence'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      type: asString(item?.type) as 'snapshot' | 'selection' | 'delta' | 'external',
      sourceId: asString(item?.sourceId),
      summary: asString(item?.summary),
    }))
    .filter(
      (item) =>
        item.sourceId &&
        item.summary &&
        (item.type === 'snapshot' || item.type === 'selection' || item.type === 'delta' || item.type === 'external')
    );
}

export function normalizeTaskPackagePayload(
  payload: any,
  options: NormalizeOptions
): { normalized: NormalizedTaskPackage; findings: NormalizeFindings } {
  const isV2 = payload?.manifest?.schemaVersion === 'tpkg-0.2';
  const liftedFromVersion = isV2
    ? 'tpkg-0.2'
    : payload?.manifest?.schemaVersion === 'tpkg-0.1'
    ? 'tpkg-0.1'
    : 'unknown';

  const missingFields: string[] = [];
  const markMissing = (path: string, ok: boolean) => {
    if (!ok) missingFields.push(path);
  };

  markMissing('manifest.schemaVersion', hasString(payload, 'manifest.schemaVersion'));
  markMissing('manifest.createdAt', hasString(payload, 'manifest.createdAt'));
  markMissing('manifest.updatedAt', hasString(payload, 'manifest.updatedAt'));
  markMissing('manifest.title', hasString(payload, 'manifest.title'));
  markMissing('manifest.capabilities.applyModes', hasArray(payload, 'manifest.capabilities.applyModes'));
  markMissing('manifest.capabilities.conflictHandling', hasString(payload, 'manifest.capabilities.conflictHandling'));

  markMissing('intent.primary', hasString(payload, 'intent.primary') || hasString(payload, 'intent.text'));
  markMissing('intent.successCriteria', hasArray(payload, 'intent.successCriteria'));
  markMissing('intent.nonGoals', hasArray(payload, 'intent.nonGoals'));

  markMissing('state.facts', hasArray(payload, 'state.facts'));
  markMissing('state.decisions', hasArray(payload, 'state.decisions'));
  markMissing('state.assumptions', hasArray(payload, 'state.assumptions'));
  markMissing('state.openLoops', hasArray(payload, 'state.openLoops'));

  markMissing('constraints.technical', hasArray(payload, 'constraints.technical'));
  markMissing('constraints.process', hasArray(payload, 'constraints.process'));
  markMissing('constraints.policy', hasArray(payload, 'constraints.policy'));

  markMissing('interfaces.apis', hasArray(payload, 'interfaces.apis'));
  markMissing('interfaces.modules', hasArray(payload, 'interfaces.modules') || hasArray(payload, 'constraints.interfaces'));

  markMissing('risks', hasArray(payload, 'risks'));
  markMissing('evidence', hasArray(payload, 'evidence'));

  markMissing('history.origin', hasString(payload, 'history.origin'));
  markMissing('history.revision', hasNumber(payload, 'history.revision'));

  markMissing('compat.accepts', hasArray(payload, 'compat.accepts'));
  markMissing('compat.downgradeStrategy', hasString(payload, 'compat.downgradeStrategy'));

  const manifestInput = payload?.manifest || {};
  const applyModes = asStringArray(manifestInput?.capabilities?.applyModes);
  const normalizedApplyModes =
    applyModes.length > 0
      ? applyModes.filter((m) => m === 'bootstrap' || m === 'constrain' || m === 'review')
      : [];

  const normalized: NormalizedTaskPackage = {
    manifest: {
      schemaVersion: 'tpkg-0.2',
      packageId: typeof manifestInput?.packageId === 'string' ? manifestInput.packageId : undefined,
      createdAt: asString(manifestInput?.createdAt),
      updatedAt: asString(manifestInput?.updatedAt || manifestInput?.createdAt),
      title: asString(manifestInput?.title),
      description: typeof manifestInput?.description === 'string' ? manifestInput.description : undefined,
      capabilities: {
        applyModes: normalizedApplyModes.length > 0 ? normalizedApplyModes : ['bootstrap', 'constrain', 'review'],
        conflictHandling: 'report_only',
      },
    },
    intent: {
      primary: asString(payload?.intent?.primary || payload?.intent?.text || payload?.raw?.snapshotV1?.anchorIntent?.description),
      successCriteria: asStringArray(payload?.intent?.successCriteria),
      nonGoals: asStringArray(payload?.intent?.nonGoals),
    },
    state: {
      facts: asStringArray(payload?.state?.facts),
      decisions: asStringArray(payload?.state?.decisions),
      assumptions: asStringArray(payload?.state?.assumptions),
      openLoops: asStringArray(payload?.state?.openLoops),
    },
    constraints: {
      technical: asStringArray(payload?.constraints?.technical),
      process: asStringArray(payload?.constraints?.process),
      policy: asStringArray(payload?.constraints?.policy),
    },
    interfaces: {
      apis: asApiArray(payload?.interfaces?.apis),
      modules:
        asStringArray(payload?.interfaces?.modules).length > 0
          ? asStringArray(payload?.interfaces?.modules)
          : asStringArray(payload?.constraints?.interfaces),
    },
    risks: asRiskArray(payload?.risks),
    evidence: asEvidenceArray(payload?.evidence),
    history: {
      origin:
        payload?.history?.origin === 'snapshot' ||
        payload?.history?.origin === 'import' ||
        payload?.history?.origin === 'manual'
          ? payload.history.origin
          : options.sourceSnapshotId
          ? 'snapshot'
          : 'manual',
      derivedFrom: typeof payload?.history?.derivedFrom === 'string' ? payload.history.derivedFrom : undefined,
      revision: options.revision,
    },
    compat: {
      accepts: asStringArray(payload?.compat?.accepts).length > 0 ? asStringArray(payload?.compat?.accepts) : ['tpkg-0.1'],
      downgradeStrategy: 'lossy-allowed',
    },
  };

  return {
    normalized,
    findings: {
      missingFields,
      liftedFromVersion,
    },
  };
}
