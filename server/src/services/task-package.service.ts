import { LLMProvider, Prisma, TaskPackageStatus } from '@prisma/client';
import { prisma, logger } from '../utils';
import { LLMService } from './llm.service';
import { UserService } from './user.service';
import { normalizeTaskPackagePayload, type ApplyMode, type NormalizedTaskPackage, type NormalizeFindings } from './task-package.normalize';
import { detectConflicts as detectQuestionConflicts, type Conflict } from './task-package.conflicts';
import { buildTaskPackagePayloadV2 } from './task-package.payload';
import { computeRevisionHash } from './task-package.hash';
import { stableHash } from '../algebra/semanticDiff/key';
import type { DomainName, SemanticDelta } from '../algebra/semanticDiff/types';
import { applyDelta } from '../algebra/stateTransition/applyDelta';
import { detectConflicts as detectTransitionConflicts } from '../algebra/stateTransition/detectConflicts';
import type { TransitionConflict, TransitionFinding, TransitionMode, TransitionPerDomainCounts } from '../algebra/stateTransition/types';
import { computeRevisionDelta, revisionToSemanticState, summarizeDelta, type RevisionLike } from './task-package-revision-delta';
import { applyRevisionNetDelta } from './revision-apply-net-delta.service';
import { parseLLMDelta } from './llm-delta-parser';
import { buildApplyReportV1, type ApplyReportV1 } from './apply-report-v1';
import { buildExecutionRecordV1, type ExecutionRecordV1 } from './execution-record-v1';
import { replayExecutionRecordV1 } from './execution-replay.service';
import { planDeltaClosureV1, type ClosureRejected, type ClosureSuggestion } from './delta-closure-planner';
import { DEFAULT_RISK_POLICY_V1, normalizeRiskPolicyV1, type RiskPolicyV1 } from './delta-risk-policy';

export type CreatePackageFromSnapshotInput = {
  title?: string;
  description?: string;
  sourceSnapshotId: string;
};

export type ImportPackageInput = {
  title?: string;
  description?: string;
  payload: any;
};

export type ApplyPackageInput = {
  userQuestion: string;
  mode?: ApplyMode;
  provider?: LLMProvider;
  model?: string;
  payload?: unknown;
  schemaVersion?: string;
};

type ApplyExecutionOptions = {
  llmMode?: 'legacy' | 'skip' | 'delta';
  llmDeltaMode?: TransitionMode;
  llmDelta?: unknown;
  revisionNetDelta?: {
    fromRevisionId: string;
    toRevisionId: string;
    mode?: TransitionMode;
  };
  riskPolicy?: RiskPolicyV1;
  taskProfile?: {
    name: string;
    riskPolicy?: RiskPolicyV1;
  };
  audit?: {
    record?: boolean;
    replay?: boolean;
  };
};

export type CreateRevisionInput = {
  payload: any;
  summary?: string;
  schemaVersion?: string;
  setCurrent?: boolean;
  parentRevisionId?: string | null;
};

type ApplyReportV2 = {
  mode: ApplyMode;
  usedFields: string[];
  findings: NormalizeFindings;
  conflicts: Conflict[];
  counts: {
    facts: number;
    decisions: number;
    assumptions: number;
    openLoops: number;
    evidence: number;
  };
  contract: {
    conflictHandling: 'report_only';
  };
  transition?: {
    mode: TransitionMode;
    deltaSummary: ReturnType<typeof summarizeDelta>;
    appliedCounts: TransitionPerDomainCounts;
    rejectedCounts: TransitionPerDomainCounts;
    conflicts: TransitionConflict[];
    postApplyConflicts: TransitionConflict[];
    findings: TransitionFinding[];
    stateHashBefore: string;
    stateHashAfter: string;
  };
  revisionNetDelta?: {
    fromRevisionId: string;
    toRevisionId: string;
    mode: TransitionMode;
    deltaSummary: ReturnType<typeof summarizeDelta>;
    stateHashBefore: string;
    stateHashAfter: string;
    conflictsCount: number;
    deltaFromTo?: SemanticDelta;
  };
  llmDelta?: {
    mode: 'delta';
    deltaSummary: ReturnType<typeof summarizeDelta>;
    conflicts: TransitionConflict[];
    postApplyConflicts: TransitionConflict[];
    stateHashBefore: string;
    stateHashAfter: string;
    delta?: SemanticDelta;
    closure?: {
      schema: 'delta-closure-plan-1';
      policy: {
        schema: 'risk-policy-1';
        strict: {
          requirePostApplyConflictsZero: true;
          fieldLevelModify: 'off' | 'on';
          dependencyScope: 'same_domain' | 'cross_domain';
          priority: 'explainability' | 'acceptance';
          targetAcceptanceRatio: number;
        };
      };
      acceptedSummary?: ReturnType<typeof summarizeDelta>;
      rejectedCount: number;
      rejectedPreview?: ClosureRejected[];
      rejected: ClosureRejected[];
      suggestions: ClosureSuggestion[];
      suggestionDiagnostics: {
        suggestionCount: number;
        coveredRejectedCount: number;
        blockedByCoveredCount: number;
      };
      diagnostics: {
        candidateCount: number;
        acceptedCount: number;
        rejectedCount: number;
        maxClosureSizeRatio: number;
        blockedByRate: number;
        closureViolationFlag: boolean;
      };
    };
  };
  v1?: ApplyReportV1;
  executionRecordV1?: ExecutionRecordV1;
};

const TRANSITION_DOMAIN_ORDER: DomainName[] = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'];
const TRANSITION_DOMAIN_RANK = new Map<DomainName, number>(
  TRANSITION_DOMAIN_ORDER.map((domain, index) => [domain, index])
);

type ErrCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'NO_REVISION'
  | 'INVALID_INPUT'
  | 'E_LLM_DELTA_CONFLICT'
  | 'E_REPLAY_MISMATCH'
  | 'E_REPLAY_UNSUPPORTED'
  | 'E_RISK_POLICY_INVALID'
  | 'CONFLICT_RETRY_EXHAUSTED';

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; code: ErrCode };
type Result<T> = Ok<T> | Err;

const SERVICE_ERROR_CODES = new Set<ErrCode>([
  'NOT_FOUND',
  'FORBIDDEN',
  'NO_REVISION',
  'INVALID_INPUT',
  'E_LLM_DELTA_CONFLICT',
  'E_REPLAY_MISMATCH',
  'E_REPLAY_UNSUPPORTED',
  'E_RISK_POLICY_INVALID',
  'CONFLICT_RETRY_EXHAUSTED',
]);

function asErrCode(value: unknown): ErrCode | null {
  if (typeof value !== 'string') return null;
  return SERVICE_ERROR_CODES.has(value as ErrCode) ? (value as ErrCode) : null;
}

function throwServiceError(code: ErrCode): never {
  const error = new Error(code);
  (error as any).code = code;
  throw error;
}

function normalizeServiceError(err: unknown): ErrCode {
  if (!err) return 'INVALID_INPUT';
  if (typeof err === 'string') return asErrCode(err) ?? 'INVALID_INPUT';
  if (err instanceof Error) {
    const code = asErrCode((err as any).code) ?? asErrCode(err.message);
    if (code) return code;
    const rawCode = (err as any).code;
    if (rawCode === 'E_LLM_DELTA_CONFLICT') return 'E_LLM_DELTA_CONFLICT';
    if (rawCode === 'E_REPLAY_MISMATCH') return 'E_REPLAY_MISMATCH';
    if (rawCode === 'E_REPLAY_UNSUPPORTED') return 'E_REPLAY_UNSUPPORTED';
    if (rawCode === 'E_RISK_POLICY_INVALID') return 'E_RISK_POLICY_INVALID';
    if (typeof rawCode === 'string' && rawCode.startsWith('LLM_')) return 'INVALID_INPUT';
    if (typeof rawCode === 'string' && rawCode.startsWith('E_LLM_DELTA_')) return 'INVALID_INPUT';
    if (typeof rawCode === 'string' && rawCode.startsWith('E_EXECUTION_RECORD_')) return 'INVALID_INPUT';
    if (rawCode === 'API_KEY_NOT_FOUND') return 'INVALID_INPUT';
  }
  return 'INVALID_INPUT';
}

function isRevisionUniqueConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  if (Array.isArray(target)) {
    const parts = target.map((item) => String(item));
    return parts.includes('packageId') && parts.includes('rev');
  }
  if (typeof target === 'string') {
    return target.includes('packageId') && target.includes('rev');
  }
  return false;
}

function isRevisionHashUniqueConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  if (Array.isArray(target)) {
    const parts = target.map((item) => String(item));
    return parts.includes('packageId') && parts.includes('revisionHash');
  }
  if (typeof target === 'string') {
    return target.includes('packageId') && target.includes('revisionHash');
  }
  return false;
}

function sortTransitionConflict(a: TransitionConflict, b: TransitionConflict): number {
  return (
    (TRANSITION_DOMAIN_RANK.get(a.domain) ?? 0) - (TRANSITION_DOMAIN_RANK.get(b.domain) ?? 0) ||
    a.code.localeCompare(b.code) ||
    (a.key ?? '').localeCompare(b.key ?? '') ||
    (a.path ?? '').localeCompare(b.path ?? '') ||
    a.message.localeCompare(b.message)
  );
}

function sortTransitionFinding(a: TransitionFinding, b: TransitionFinding): number {
  return (
    a.code.localeCompare(b.code) ||
    (a.count ?? 0) - (b.count ?? 0) ||
    (a.message ?? '').localeCompare(b.message ?? '') ||
    (a.domains ?? []).join(',').localeCompare((b.domains ?? []).join(','))
  );
}

function buildPostApplyFinding(conflicts: TransitionConflict[]): TransitionFinding | null {
  if (conflicts.length === 0) return null;
  return {
    code: 'POST_APPLY_CONFLICTS',
    count: conflicts.length,
    domains: TRANSITION_DOMAIN_ORDER.filter((domain) => conflicts.some((conflict) => conflict.domain === domain)),
  };
}

function mergeTransitionFindings(base: TransitionFinding[], postApply: TransitionConflict[]): TransitionFinding[] {
  const postApplyFinding = buildPostApplyFinding(postApply);
  const next = postApplyFinding ? [...base, postApplyFinding] : [...base];
  return next.sort(sortTransitionFinding);
}

function compareLiteral(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortClosureRejected(a: ClosureRejected, b: ClosureRejected): number {
  return (
    (TRANSITION_DOMAIN_RANK.get(a.domain) ?? 0) - (TRANSITION_DOMAIN_RANK.get(b.domain) ?? 0) ||
    compareLiteral(a.key ?? '', b.key ?? '') ||
    compareLiteral(a.path ?? '\uffff', b.path ?? '\uffff') ||
    compareLiteral(a.op, b.op) ||
    compareLiteral(a.reasonCode, b.reasonCode)
  );
}

function sortClosureSuggestion(a: ClosureSuggestion, b: ClosureSuggestion): number {
  return (
    (TRANSITION_DOMAIN_RANK.get(a.appliesTo.domain) ?? 0) - (TRANSITION_DOMAIN_RANK.get(b.appliesTo.domain) ?? 0) ||
    compareLiteral(a.appliesTo.key ?? '', b.appliesTo.key ?? '') ||
    compareLiteral(a.appliesTo.path ?? '￿', b.appliesTo.path ?? '￿') ||
    compareLiteral(a.kind, b.kind) ||
    compareLiteral(a.suggestionId, b.suggestionId)
  );
}

function sortReportV1Finding(
  a: ApplyReportV1['findings'][number],
  b: ApplyReportV1['findings'][number]
): number {
  return (
    compareLiteral(a.code, b.code) ||
    compareLiteral(a.message ?? '', b.message ?? '') ||
    (a.count ?? 0) - (b.count ?? 0) ||
    compareLiteral((a.domains ?? []).join(','), (b.domains ?? []).join(','))
  );
}

function buildClosureDiagnosticsFindings(
  diagnostics: {
    candidateCount: number;
    acceptedCount: number;
    rejectedCount: number;
    maxClosureSizeRatio: number;
    blockedByRate: number;
    closureViolationFlag: boolean;
  },
  hasPostApplyConflict: boolean
): ApplyReportV1['findings'] {
  const findings: ApplyReportV1['findings'] = [
    { code: 'CLOSURE_CANDIDATE_COUNT', count: diagnostics.candidateCount },
    { code: 'CLOSURE_ACCEPTED_COUNT', count: diagnostics.acceptedCount },
    { code: 'CLOSURE_REJECTED_COUNT', count: diagnostics.rejectedCount },
    { code: 'CLOSURE_MAX_CLOSURE_SIZE_RATIO', count: diagnostics.maxClosureSizeRatio },
    { code: 'CLOSURE_BLOCKED_BY_RATE', count: diagnostics.blockedByRate },
  ];

  if (diagnostics.closureViolationFlag) {
    findings.push({ code: 'CLOSURE_VIOLATION_FLAG', count: 1 });
  }

  if (hasPostApplyConflict) {
    findings.push({ code: 'CLOSURE_POST_APPLY_CONFLICT' });
  }

  return findings.sort(sortReportV1Finding);
}

export class TaskPackageService {
  private llmService = new LLMService();
  private userService = new UserService();

  /**
   * 鍒楄〃
   */
  async list(userId: string): Promise<Result<{ items: any[] }>> {
    const items = await prisma.taskPackage.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        currentRevision: {
          select: { id: true, rev: true, schemaVersion: true, createdAt: true, summary: true },
        },
      },
    });

    return { ok: true, data: { items } };
  }

  /**
   * 鑾峰彇褰掑睘鏍￠獙鍚庣殑 package锛堝惈 currentRevision锛?   */
  async getOwned(userId: string, packageId: string): Promise<any> {
    const pkg = await prisma.taskPackage.findUnique({
      where: { id: packageId },
      include: { currentRevision: true },
    });

    if (!pkg) throwServiceError('NOT_FOUND');
    if (pkg.userId !== userId) throwServiceError('FORBIDDEN');
    return pkg;
  }

  /**
   * 浠?StateSnapshot 鐢熸垚涓€涓?TaskPackage锛堣劚閽╁疄浣擄級
   * - 鐢熸垚 rev=0
   * - package.currentRevisionId 鎸囧悜 rev=0
   */
  async createFromSnapshot(
    userId: string,
    input: CreatePackageFromSnapshotInput,
    options?: { targetSchemaVersion?: 'tpkg-0.1' | 'tpkg-0.2' }
  ): Promise<{ pkg: any; revision: any }> {
    const snap = await prisma.stateSnapshot.findUnique({
      where: { id: input.sourceSnapshotId },
      select: { id: true, userId: true, subthreadId: true, snapshot: true },
    });

    if (!snap) throwServiceError('NOT_FOUND');
    if (snap.userId !== userId) throwServiceError('FORBIDDEN');

    const targetSchemaVersion = options?.targetSchemaVersion ?? 'tpkg-0.1';
    const payloadV1 = this.buildPackagePayloadFromSnapshot(snap.snapshot);
    const payload =
      targetSchemaVersion === 'tpkg-0.2'
        ? buildTaskPackagePayloadV2(payloadV1, {
            revision: 0,
            sourceSnapshotId: snap.id,
            title: input.title ?? null,
            description: input.description ?? null,
            origin: 'snapshot',
          }).payload
        : payloadV1;

    const out = await prisma.$transaction(async (tx) => {
      const pkg = await tx.taskPackage.create({
        data: {
          userId,
          sourceSnapshotId: snap.id,
          title: input.title ?? null,
          description: input.description ?? null,
          status: TaskPackageStatus.ACTIVE,
        },
      });

      const rev0 = await tx.taskPackageRevision.create({
        data: {
          packageId: pkg.id,
          rev: 0,
          revisionHash: computeRevisionHash(payload),
          schemaVersion: targetSchemaVersion,
          payload: payload as Prisma.InputJsonValue,
          summary: this.makePayloadSummary(payload),
        },
      });

      const updated = await tx.taskPackage.update({
        where: { id: pkg.id },
        data: { currentRevisionId: rev0.id },
        include: { currentRevision: true },
      });

      return { pkg: updated, revision: rev0 };
    });

    return out;
  }

  /**
   * 瀵煎叆涓€涓?package锛圝SON锛?   */
  async importPackage(
    userId: string,
    input: ImportPackageInput,
    options?: { targetSchemaVersion?: 'tpkg-0.1' | 'tpkg-0.2' }
  ): Promise<{ pkg: any; revision: any }> {
    const payload = input.payload ?? {};
    const targetSchemaVersion = options?.targetSchemaVersion;
    const useV2 = targetSchemaVersion === 'tpkg-0.2';
    const payloadToStore = useV2
      ? buildTaskPackagePayloadV2(payload, {
          revision: 0,
          origin: 'import',
          title: input.title ?? (payload?.manifest?.title ?? null),
          description: input.description ?? (payload?.manifest?.description ?? null),
        }).payload
      : payload;
    const schemaVersion = useV2 ? 'tpkg-0.2' : String(payload?.manifest?.schemaVersion || 'tpkg-0.1');

    const out = await prisma.$transaction(async (tx) => {
      const pkg = await tx.taskPackage.create({
        data: {
          userId,
          title: input.title ?? (payloadToStore?.manifest?.title ?? null),
          description: input.description ?? (payloadToStore?.manifest?.description ?? null),
          status: TaskPackageStatus.ACTIVE,
        },
      });

      const rev0 = await tx.taskPackageRevision.create({
        data: {
          packageId: pkg.id,
          rev: 0,
          revisionHash: computeRevisionHash(payloadToStore),
          schemaVersion,
          payload: payloadToStore as Prisma.InputJsonValue,
          summary: this.makePayloadSummary(payloadToStore),
        },
      });

      const updated = await tx.taskPackage.update({
        where: { id: pkg.id },
        data: { currentRevisionId: rev0.id },
        include: { currentRevision: true },
      });

      return { pkg: updated, revision: rev0 };
    });

    return out;
  }

  /**
   * Create revision (rev+1). Default behavior keeps currentRevision unchanged.
   */
  async createRevision(
    userId: string,
    packageId: string,
    input: CreateRevisionInput
  ): Promise<{
    packageId: string;
    revision: { id: string; rev: number; schemaVersion: string; createdAt: Date };
    currentRevisionId: string | null;
  }> {
    const pkg = await prisma.taskPackage.findUnique({
      where: { id: packageId },
      select: { id: true, userId: true },
    });

    if (!pkg) throwServiceError('NOT_FOUND');
    if (pkg.userId !== userId) throwServiceError('FORBIDDEN');

    const payload = (input.payload ?? {}) as Prisma.InputJsonValue;
    const schemaVersion = String(input.schemaVersion || (input.payload as any)?.manifest?.schemaVersion || 'tpkg-0.1');
    const revisionHash = computeRevisionHash(payload);
    const explicitParentRevisionId = input.parentRevisionId;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await prisma.$transaction(async (tx) => {
          const ownedPackage = await tx.taskPackage.findUnique({
            where: { id: packageId },
            select: { id: true, userId: true, currentRevisionId: true },
          });

          if (!ownedPackage) throwServiceError('NOT_FOUND');
          if (ownedPackage.userId !== userId) throwServiceError('FORBIDDEN');

          const existingRevision = await tx.taskPackageRevision.findFirst({
            where: { packageId, revisionHash },
            select: { id: true, rev: true, schemaVersion: true, createdAt: true },
          });

          if (existingRevision) {
            let currentRevisionId = ownedPackage.currentRevisionId;
            if (input.setCurrent === true) {
              const updatedPackage = await tx.taskPackage.update({
                where: { id: packageId },
                data: { currentRevisionId: existingRevision.id },
                select: { currentRevisionId: true },
              });
              currentRevisionId = updatedPackage.currentRevisionId;
            }

            return {
              packageId,
              revision: existingRevision,
              currentRevisionId,
            };
          }

          const revMax = await tx.taskPackageRevision.aggregate({
            where: { packageId },
            _max: { rev: true },
          });
          const nextRev = (revMax._max.rev ?? -1) + 1;
          const parentRevisionId =
            explicitParentRevisionId !== undefined
              ? explicitParentRevisionId
              : (ownedPackage.currentRevisionId ?? null);

          if (parentRevisionId) {
            const parentRevision = await tx.taskPackageRevision.findUnique({
              where: { id: parentRevisionId },
              select: { packageId: true },
            });
            if (!parentRevision || parentRevision.packageId !== packageId) {
              throwServiceError('INVALID_INPUT');
            }
          }

          const revision = await tx.taskPackageRevision.create({
            data: {
              packageId,
              parentRevisionId,
              rev: nextRev,
              revisionHash,
              schemaVersion,
              payload,
              summary: input.summary ?? this.makePayloadSummary(payload),
            },
            select: { id: true, rev: true, schemaVersion: true, createdAt: true },
          });

          let currentRevisionId = ownedPackage.currentRevisionId;
          if (input.setCurrent === true) {
            const updatedPackage = await tx.taskPackage.update({
              where: { id: packageId },
              data: { currentRevisionId: revision.id },
              select: { currentRevisionId: true },
            });
            currentRevisionId = updatedPackage.currentRevisionId;
          }

          return {
            packageId,
            revision,
            currentRevisionId,
          };
        });
      } catch (err) {
        if (isRevisionHashUniqueConflict(err)) {
          const existingRevision = await prisma.taskPackageRevision.findFirst({
            where: { packageId, revisionHash },
            select: { id: true, rev: true, schemaVersion: true, createdAt: true },
          });
          if (existingRevision) {
            let currentRevisionId =
              (
                await prisma.taskPackage.findUnique({
                  where: { id: packageId },
                  select: { currentRevisionId: true },
                })
              )?.currentRevisionId ?? null;
            if (input.setCurrent === true) {
              const updatedPackage = await prisma.taskPackage.update({
                where: { id: packageId },
                data: { currentRevisionId: existingRevision.id },
                select: { currentRevisionId: true },
              });
              currentRevisionId = updatedPackage.currentRevisionId;
            }
            return {
              packageId,
              revision: existingRevision,
              currentRevisionId,
            };
          }
          if (attempt === 0) continue;
          throwServiceError('CONFLICT_RETRY_EXHAUSTED');
        }
        if (isRevisionUniqueConflict(err)) {
          if (attempt === 0) continue;
          throwServiceError('CONFLICT_RETRY_EXHAUSTED');
        }
        throw err;
      }
    }

    throwServiceError('CONFLICT_RETRY_EXHAUSTED');
  }

  async setCurrentRevision(
    userId: string,
    packageId: string,
    revisionId: string
  ): Promise<{ packageId: string; currentRevisionId: string; currentRevNumber: number }> {
    const pkg = await prisma.taskPackage.findUnique({
      where: { id: packageId },
      select: { id: true, userId: true },
    });

    if (!pkg) throwServiceError('NOT_FOUND');
    if (pkg.userId !== userId) throwServiceError('FORBIDDEN');

    const revision = await prisma.taskPackageRevision.findUnique({
      where: { id: revisionId },
      select: { id: true, packageId: true, rev: true },
    });

    if (!revision) throwServiceError('NOT_FOUND');
    if (revision.packageId !== packageId) throwServiceError('INVALID_INPUT');

    await prisma.taskPackage.update({
      where: { id: packageId },
      data: { currentRevisionId: revisionId },
    });

    return {
      packageId,
      currentRevisionId: revisionId,
      currentRevNumber: revision.rev,
    };
  }

  async getPackage(userId: string, packageId: string): Promise<{
    package: {
      id: string;
      title: string | null;
      description: string | null;
      status: TaskPackageStatus;
      createdAt: Date;
      updatedAt: Date;
      sourceSnapshotId: string | null;
      sourceContextId: string | null;
    };
    currentRevision: {
      id: string;
      rev: number;
      schemaVersion: string;
      createdAt: Date;
      summary: string | null;
    } | null;
  }> {
    const pkg = await prisma.taskPackage.findUnique({
      where: { id: packageId },
      select: {
        id: true,
        userId: true,
        title: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        sourceSnapshotId: true,
        sourceContextId: true,
        currentRevision: {
          select: { id: true, rev: true, schemaVersion: true, createdAt: true, summary: true },
        },
      },
    });

    if (!pkg) throwServiceError('NOT_FOUND');
    if (pkg.userId !== userId) throwServiceError('FORBIDDEN');

    return {
      package: {
        id: pkg.id,
        title: pkg.title,
        description: pkg.description,
        status: pkg.status,
        createdAt: pkg.createdAt,
        updatedAt: pkg.updatedAt,
        sourceSnapshotId: pkg.sourceSnapshotId,
        sourceContextId: pkg.sourceContextId,
      },
      currentRevision: pkg.currentRevision,
    };
  }

  /**
   * 瀵煎嚭褰撳墠 revision 鐨?payload
   */
  async exportPackage(userId: string, packageId: string): Promise<any> {
    const pkg = await this.getOwned(userId, packageId);
    if (!pkg.currentRevision) throwServiceError('NO_REVISION');

    return {
      package: {
        id: pkg.id,
        title: pkg.title,
        description: pkg.description,
        status: pkg.status,
        createdAt: pkg.createdAt,
        updatedAt: pkg.updatedAt,
      },
      revision: {
        id: pkg.currentRevision.id,
        rev: pkg.currentRevision.rev,
        schemaVersion: pkg.currentRevision.schemaVersion,
        createdAt: pkg.currentRevision.createdAt,
        summary: pkg.currentRevision.summary,
      },
      payload: pkg.currentRevision.payload,
    };
  }

  /**
   * Apply锛氳緭鍏?packageId + userQuestion 鈫?LLM 鍥炲 + applyReport
   */
  async applyPackage(
    userId: string,
    packageId: string,
    input: ApplyPackageInput,
    opts?: ApplyExecutionOptions
  ): Promise<Result<any>> {
    try {
      const pkg = await this.getOwned(userId, packageId);
      if (!pkg.currentRevision) throwServiceError('NO_REVISION');

      const currentPayload = pkg.currentRevision.payload as any;
      const targetPayload = (input.payload ?? currentPayload) as any;
      const mode = (input.mode || 'bootstrap') as ApplyMode;
      const llmMode = opts?.llmMode ?? 'legacy';
      const llmDeltaMode: TransitionMode = opts?.llmDeltaMode ?? 'best_effort';
      const revisionNetDeltaOptions = opts?.revisionNetDelta;
      const transitionMode: TransitionMode = revisionNetDeltaOptions?.mode ?? 'best_effort';
      const auditRecordEnabled = opts?.audit?.record === true;
      const auditReplayEnabled = opts?.audit?.replay === true;
      const rawRiskPolicy = opts?.taskProfile?.riskPolicy ?? opts?.riskPolicy ?? DEFAULT_RISK_POLICY_V1;
      const effectiveRiskPolicy = normalizeRiskPolicyV1(rawRiskPolicy);
      if (!effectiveRiskPolicy) {
        const riskPolicyError = new Error('Risk policy is invalid');
        (riskPolicyError as { code?: string }).code = 'E_RISK_POLICY_INVALID';
        throw riskPolicyError;
      }

      const baseRevision: RevisionLike = {
        payload: currentPayload,
        schemaVersion: pkg.currentRevision.schemaVersion,
        revisionHash:
          typeof pkg.currentRevision.revisionHash === 'string' ? pkg.currentRevision.revisionHash : undefined,
      };
      const targetRevision: RevisionLike = {
        payload: targetPayload,
        schemaVersion: input.schemaVersion ?? String(targetPayload?.manifest?.schemaVersion || pkg.currentRevision.schemaVersion),
        revisionHash: typeof targetPayload?.revisionHash === 'string' ? targetPayload.revisionHash : undefined,
      };

      let transitionBase: ReturnType<typeof applyDelta>;
      let deltaSummary: ReturnType<typeof summarizeDelta>;
      let stateHashBefore: string;
      let stateHashAfter: string;
      let revisionNetDeltaReport: ApplyReportV2['revisionNetDelta'];

      if (revisionNetDeltaOptions) {
        const netDelta = await applyRevisionNetDelta({
          taskPackageId: packageId,
          fromRevisionId: revisionNetDeltaOptions.fromRevisionId,
          toRevisionId: revisionNetDeltaOptions.toRevisionId,
          mode: transitionMode,
        });

        transitionBase = netDelta.transition;
        deltaSummary = netDelta.deltaSummary;
        stateHashBefore = netDelta.stateHashBefore;
        stateHashAfter = netDelta.stateHashAfter;
        revisionNetDeltaReport = {
          fromRevisionId: revisionNetDeltaOptions.fromRevisionId,
          toRevisionId: revisionNetDeltaOptions.toRevisionId,
          mode: transitionMode,
          deltaSummary,
          stateHashBefore,
          stateHashAfter,
          conflictsCount: transitionBase.conflicts.length,
          deltaFromTo: netDelta.delta,
        };
      } else {
        const baseState = revisionToSemanticState(baseRevision);
        const delta = computeRevisionDelta(baseRevision, targetRevision);
        deltaSummary = summarizeDelta(delta);
        transitionBase = applyDelta(baseState, delta, { mode: transitionMode });
        stateHashBefore = stableHash(baseState);
        stateHashAfter = stableHash(transitionBase.nextState);
      }

      const transitionConflicts = [...transitionBase.conflicts].sort(sortTransitionConflict);
      const postApplyConflicts = detectTransitionConflicts(transitionBase.nextState).sort(sortTransitionConflict);
      const transitionFindings = mergeTransitionFindings(transitionBase.findings, postApplyConflicts);
      const transitionReport: NonNullable<ApplyReportV2['transition']> = {
        mode: transitionMode,
        deltaSummary,
        appliedCounts: transitionBase.applied.perDomain,
        rejectedCounts: transitionBase.rejected.perDomain,
        conflicts: transitionConflicts,
        postApplyConflicts,
        findings: transitionFindings,
        stateHashBefore,
        stateHashAfter,
      };

      const { normalized, findings } = normalizeTaskPackagePayload(targetPayload, {
        revision: pkg.currentRevision.rev ?? 0,
        sourceSnapshotId: pkg.sourceSnapshotId,
      });
      const conflicts = detectQuestionConflicts({ userQuestion: input.userQuestion, normalized, mode });
      let applyReport = this.buildApplyReportV2(
        normalized,
        mode,
        findings,
        conflicts,
        transitionReport,
        revisionNetDeltaReport
      );

      const attachV1 = (
        report: ApplyReportV2,
        llmDeltaReport?: ApplyReportV2['llmDelta']
      ): ApplyReportV2 => ({
        ...report,
        v1: buildApplyReportV1({
          llmMode,
          transitionMode: llmMode === 'delta' ? llmDeltaMode : transitionMode,
          revisionNetDelta: revisionNetDeltaOptions
            ? {
                fromRevisionId: revisionNetDeltaOptions.fromRevisionId,
                toRevisionId: revisionNetDeltaOptions.toRevisionId,
              }
            : null,
          revisionNetDeltaReport: revisionNetDeltaReport
            ? {
                deltaSummary: revisionNetDeltaReport.deltaSummary,
                stateHashBefore: revisionNetDeltaReport.stateHashBefore,
                stateHashAfter: revisionNetDeltaReport.stateHashAfter,
              }
            : null,
          transition: {
            deltaSummary: transitionReport.deltaSummary,
            appliedCounts: transitionReport.appliedCounts,
            rejectedCounts: transitionReport.rejectedCounts,
            conflicts: transitionReport.conflicts,
            postApplyConflicts: transitionReport.postApplyConflicts,
            findings: transitionReport.findings,
            stateHashBefore: transitionReport.stateHashBefore,
            stateHashAfter: transitionReport.stateHashAfter,
          },
          llmDelta: llmDeltaReport
            ? {
                deltaSummary: llmDeltaReport.deltaSummary,
                conflicts: llmDeltaReport.conflicts,
                postApplyConflicts: llmDeltaReport.postApplyConflicts,
                stateHashBefore: llmDeltaReport.stateHashBefore,
                stateHashAfter: llmDeltaReport.stateHashAfter,
              }
            : null,
          baseRevisionId: pkg.currentRevision.id,
          targetRevisionId: revisionNetDeltaOptions?.toRevisionId ?? null,
          usedInjectedDelta: opts?.llmDelta !== undefined,
        }),
      });

      applyReport = attachV1(applyReport);

      const attachExecutionAudit = async (
        report: ApplyReportV2,
        params: {
          delta: SemanticDelta | null;
          replayBaseState: unknown | null;
        }
      ): Promise<ApplyReportV2> => {
        if (!auditRecordEnabled && !auditReplayEnabled) return report;

        const buildExecutionRecord = () =>
          buildExecutionRecordV1({
            taskPackageId: pkg.id,
            packageRevisionId: pkg.currentRevision.id,
            baseRevisionId: pkg.currentRevision.id,
            targetRevisionId: report.revisionNetDelta?.toRevisionId ?? null,
            llmMode,
            transitionMode: transitionMode,
            llmDeltaMode: llmMode === 'delta' ? llmDeltaMode : null,
            revisionNetDelta: report.revisionNetDelta
              ? {
                  fromRevisionId: report.revisionNetDelta.fromRevisionId,
                  toRevisionId: report.revisionNetDelta.toRevisionId,
                }
              : null,
            usedInjectedDelta: opts?.llmDelta !== undefined,
            applyReportV1: report.v1!,
            delta: params.delta,
            deltaSummary:
              report.llmDelta?.deltaSummary ??
              report.revisionNetDelta?.deltaSummary ??
              report.transition?.deltaSummary ??
              null,
            stateHashBefore:
              report.llmDelta?.stateHashBefore ??
              report.revisionNetDelta?.stateHashBefore ??
              report.transition?.stateHashBefore ??
              null,
            stateHashAfter:
              report.llmDelta?.stateHashAfter ??
              report.revisionNetDelta?.stateHashAfter ??
              report.transition?.stateHashAfter ??
              null,
          });

        if (auditReplayEnabled) {
          let replayBaseState = params.replayBaseState;
          if (!replayBaseState && report.revisionNetDelta && revisionNetDeltaOptions) {
            const fromRevisionRow = await prisma.taskPackageRevision.findUnique({
              where: { id: revisionNetDeltaOptions.fromRevisionId },
              select: { payload: true, schemaVersion: true, revisionHash: true },
            });
            if (fromRevisionRow) {
              replayBaseState = revisionToSemanticState({
                payload: fromRevisionRow.payload as any,
                schemaVersion: fromRevisionRow.schemaVersion,
                revisionHash: fromRevisionRow.revisionHash ?? undefined,
              });
            }
          }

          if (!replayBaseState) {
            const replayUnsupportedError = new Error('Replay unsupported: delta is missing');
            (replayUnsupportedError as any).code = 'E_REPLAY_UNSUPPORTED';
            throw replayUnsupportedError;
          }

          replayExecutionRecordV1({
            record: buildExecutionRecord(),
            baseState: replayBaseState,
            delta: params.delta,
          });
        }

        if (!auditRecordEnabled) return report;

        const executionRecordV1 = buildExecutionRecord();

        return {
          ...report,
          executionRecordV1,
        };
      };

      const provider: LLMProvider = input.provider || LLMProvider.OPENAI;
      const model: string = input.model || 'gpt-4o-mini';

      if (llmMode === 'skip') {
        applyReport = await attachExecutionAudit(applyReport, {
          delta: applyReport.revisionNetDelta?.deltaFromTo ?? null,
          replayBaseState: null,
        });

        return {
          ok: true,
          data: {
            packageId: pkg.id,
            revisionId: pkg.currentRevision.id,
            revisionRev: pkg.currentRevision.rev,
            provider,
            model,
            assistantReply: { content: '' },
            applyReport,
          },
        };
      }

      const { normalized: digestState, findings: digestFindings } = normalizeTaskPackagePayload(transitionBase.nextState, {
        revision: pkg.currentRevision.rev ?? 0,
        sourceSnapshotId: pkg.sourceSnapshotId,
      });

      if (llmMode === 'delta') {
        const deltaSystemPrompt = this.buildApplyDeltaSystemPrompt(digestState, mode, digestFindings, conflicts, applyReport);
        const llmDeltaInput = opts?.llmDelta;
        const llmDeltaRaw =
          llmDeltaInput !== undefined
            ? llmDeltaInput
            : (
                await this.llmService.complete({
                  messages: [
                    { role: 'system', content: deltaSystemPrompt },
                    { role: 'user', content: input.userQuestion },
                  ],
                  config: { provider, model, apiKey: await this.userService.getDecryptedApiKey(userId, provider) },
                  route: 'package_apply',
                } as any)
              ).content;

        const llmDelta = parseLLMDelta(llmDeltaRaw);
        const llmBaseState = revisionToSemanticState(baseRevision);
        const closurePlan =
          llmDeltaMode === 'strict'
            ? planDeltaClosureV1({
                baseState: llmBaseState,
                proposedDelta: llmDelta,
                mode: 'strict',
                policy: effectiveRiskPolicy,
              })
            : null;
        const appliedDelta = closurePlan ? closurePlan.acceptedDelta : llmDelta;
        const llmTransition = applyDelta(llmBaseState, appliedDelta, {
          mode: llmDeltaMode === 'strict' ? 'best_effort' : llmDeltaMode,
        });
        const llmTransitionConflicts = [...llmTransition.conflicts].sort(sortTransitionConflict);
        const llmPostApplyConflicts = detectTransitionConflicts(llmTransition.nextState).sort(sortTransitionConflict);

        const llmDeltaReport: NonNullable<ApplyReportV2['llmDelta']> = {
          mode: 'delta',
          deltaSummary: summarizeDelta(appliedDelta),
          conflicts: llmTransitionConflicts,
          postApplyConflicts: llmPostApplyConflicts,
          stateHashBefore: stableHash(llmBaseState),
          stateHashAfter: stableHash(llmTransition.nextState),
          delta: appliedDelta,
          ...(closurePlan
            ? {
                closure: {
                  schema: closurePlan.schema,
                  policy: {
                    schema: closurePlan.policy.schema,
                    strict: { ...closurePlan.policy.strict },
                  },
                  acceptedSummary: summarizeDelta(closurePlan.acceptedDelta),
                  rejectedCount: closurePlan.rejected.length,
                  rejectedPreview: [...closurePlan.rejected].sort(sortClosureRejected).slice(0, 20),
                  rejected: [...closurePlan.rejected].sort(sortClosureRejected),
                  suggestions: [...closurePlan.suggestions].sort(sortClosureSuggestion),
                  suggestionDiagnostics: closurePlan.suggestionDiagnostics,
                  diagnostics: closurePlan.diagnostics,
                },
              }
            : {}),
        };

        applyReport = this.buildApplyReportV2(
          normalized,
          mode,
          findings,
          conflicts,
          transitionReport,
          revisionNetDeltaReport,
          llmDeltaReport
        );
        applyReport = attachV1(applyReport, llmDeltaReport);
        if (closurePlan && applyReport.v1) {
          applyReport = {
            ...applyReport,
            v1: {
              ...applyReport.v1,
              findings: [
                ...applyReport.v1.findings,
                ...buildClosureDiagnosticsFindings(closurePlan.diagnostics, llmPostApplyConflicts.length > 0),
                {
                  code: 'SUGGESTIONS_EMITTED',
                  count: closurePlan.suggestionDiagnostics.suggestionCount,
                  message: 'Suggestions emitted',
                },
              ].sort(sortReportV1Finding),
            },
          };
        }
        applyReport = await attachExecutionAudit(applyReport, {
          delta: applyReport.llmDelta?.delta ?? null,
          replayBaseState: llmBaseState,
        });

        return {
          ok: true,
          data: {
            packageId: pkg.id,
            revisionId: pkg.currentRevision.id,
            revisionRev: pkg.currentRevision.rev,
            provider,
            model,
            assistantReply: { content: '' },
            applyReport,
          },
        };
      }

      const apiKey = await this.userService.getDecryptedApiKey(userId, provider);

      const systemPrompt = this.buildApplySystemPromptV2(digestState, mode, digestFindings, conflicts, applyReport);

      const llmResp = await this.llmService.complete({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input.userQuestion },
        ],
        config: { provider, model, apiKey },
        route: 'package_apply',
      } as any);

      applyReport = await attachExecutionAudit(applyReport, {
        delta: applyReport.revisionNetDelta?.deltaFromTo ?? null,
        replayBaseState: null,
      });

      return {
        ok: true,
        data: {
          packageId: pkg.id,
          revisionId: pkg.currentRevision.id,
          revisionRev: pkg.currentRevision.rev,
          provider,
          model,
          assistantReply: { content: llmResp.content },
          applyReport,
        },
      };
    } catch (err) {
      return { ok: false, code: normalizeServiceError(err) };
    }
  }

  /**
   * 鍏煎鏃?router锛歜uildApplyPayload(payload, mode) 杩欎釜鍚嶅瓧
   * 鐜板湪鍐呴儴灏辨槸 buildApplySystemPrompt
   */
  buildApplyPayload(payload: any, mode: ApplyMode) {
    return this.buildApplySystemPrompt(payload, mode);
  }

  // -----------------------
  // helpers
  // -----------------------

  private buildApplyReportV2(
    normalized: NormalizedTaskPackage,
    mode: ApplyMode,
    findings: NormalizeFindings,
    conflicts: Conflict[],
    transition: NonNullable<ApplyReportV2['transition']>,
    revisionNetDelta?: ApplyReportV2['revisionNetDelta'],
    llmDelta?: ApplyReportV2['llmDelta']
  ): ApplyReportV2 {
    const counts = {
      facts: normalized.state.facts.length,
      decisions: normalized.state.decisions.length,
      assumptions: normalized.state.assumptions.length,
      openLoops: normalized.state.openLoops.length,
      evidence: normalized.evidence.length,
    };

    return {
      mode,
      usedFields: ['manifest', 'intent', 'state', 'constraints', 'interfaces', 'risks', 'evidence', 'history', 'compat'],
      findings,
      conflicts,
      counts,
      contract: { conflictHandling: 'report_only' },
      transition,
      ...(revisionNetDelta ? { revisionNetDelta } : {}),
      ...(llmDelta ? { llmDelta } : {}),
    };
  }

  private buildApplySystemPromptV2(
    normalized: NormalizedTaskPackage,
    mode: ApplyMode,
    findings: NormalizeFindings,
    conflicts: Conflict[],
    applyReport: ApplyReportV2
  ) {
    const modeInstruction =
      mode === 'constrain'
        ? [
            `MODE: CONSTRAIN`,
            `- If conflicts exist, report them first (type/field/description).`,
            `- Provide safe alternatives.`,
            `- Then answer the userQuestion within constraints.`,
          ].join('\n')
        : mode === 'review'
        ? [
            `MODE: REVIEW`,
            `- List gaps or risks and note uncertainty.`,
            `- Then answer the userQuestion.`,
          ].join('\n')
        : [
            `MODE: BOOTSTRAP`,
            `- Start with a current state brief (3-6 bullets referencing facts/decisions/constraints).`,
            `- Then answer the userQuestion.`,
            `- If info is missing, ask up to 3 clarifying questions and state what is blocked.`,
          ].join('\n');

    const digest = this.buildPackageDigest(normalized, findings, conflicts, applyReport);

    return [
      `You are applying TaskPackage v0.2 under report_only conflict handling.`,
      `Do not modify the package; interpret it and report conflicts before answering.`,
      ``,
      modeInstruction,
      ``,
      digest,
      ``,
      `Reply in the user's language.`,
    ].join('\n');
  }

  private buildApplyDeltaSystemPrompt(
    normalized: NormalizedTaskPackage,
    mode: ApplyMode,
    findings: NormalizeFindings,
    conflicts: Conflict[],
    applyReport: ApplyReportV2
  ) {
    const digest = this.buildPackageDigest(normalized, findings, conflicts, applyReport);

    return [
      'You must return ONLY valid JSON for schemaVersion "sdiff-0.1".',
      'No markdown, no prose, no code fences.',
      'Allowed fieldChange operations: set, unset, append, remove.',
      'Use deterministic keys and include all required domain arrays.',
      `Apply mode context: ${mode}.`,
      '',
      digest,
    ].join('\n');
  }

  private buildPackageDigest(
    normalized: NormalizedTaskPackage,
    findings: NormalizeFindings,
    conflicts: Conflict[],
    applyReport: ApplyReportV2
  ) {
    const formatList = (label: string, items: string[], limit: number) => {
      const clipped = items.slice(0, limit);
      const lines = clipped.map((item) => `- ${item}`);
      if (items.length > limit) lines.push(`- ... (+${items.length - limit} more)`);
      if (lines.length === 0) lines.push(`- (empty)`);
      return [`${label} (${items.length})`, ...lines].join('\n');
    };

    const formatConflicts = () => {
      if (conflicts.length === 0) return 'Conflicts (0)\n- (none)';
      const lines = conflicts.map(
        (c) => `- ${c.type} | ${c.field} | ${c.severity} | ${c.description}`
      );
      return [`Conflicts (${conflicts.length})`, ...lines].join('\n');
    };

    const formatApis = () => {
      const apis = normalized.interfaces.apis.slice(0, 5);
      const lines = apis.map((api) => `- ${api.name} (${api.type}): ${api.contract}`);
      if (normalized.interfaces.apis.length > apis.length) {
        lines.push(`- ... (+${normalized.interfaces.apis.length - apis.length} more)`);
      }
      if (lines.length === 0) lines.push(`- (empty)`);
      return [`Interfaces.apis (${normalized.interfaces.apis.length})`, ...lines].join('\n');
    };

    const formatRisks = () => {
      const risks = normalized.risks.slice(0, 10);
      const lines = risks.map((r) => `- ${r.id} (${r.severity}): ${r.description}`);
      if (normalized.risks.length > risks.length) {
        lines.push(`- ... (+${normalized.risks.length - risks.length} more)`);
      }
      if (lines.length === 0) lines.push(`- (empty)`);
      return [`Risks (${normalized.risks.length})`, ...lines].join('\n');
    };

    const formatEvidence = () => {
      const items = normalized.evidence.slice(0, 10);
      const lines = items.map((e) => `- ${e.type} | ${e.sourceId}: ${e.summary}`);
      if (normalized.evidence.length > items.length) {
        lines.push(`- ... (+${normalized.evidence.length - items.length} more)`);
      }
      if (lines.length === 0) lines.push(`- (empty)`);
      return [`Evidence (${normalized.evidence.length})`, ...lines].join('\n');
    };

    const missing = findings.missingFields.slice(0, 20);
    const missingLines = missing.length > 0 ? missing.map((m) => `- ${m}`) : ['- (none)'];
    if (findings.missingFields.length > missing.length) {
      missingLines.push(`- ... (+${findings.missingFields.length - missing.length} more)`);
    }

    return [
      `--- PACKAGE DIGEST ---`,
      `Schema: ${normalized.manifest.schemaVersion} (liftedFrom=${findings.liftedFromVersion})`,
      `Title: ${normalized.manifest.title || '(empty)'}`,
      `CreatedAt: ${normalized.manifest.createdAt || '(missing)'} | UpdatedAt: ${normalized.manifest.updatedAt || '(missing)'}`,
      ``,
      `Intent.primary: ${normalized.intent.primary || '(empty)'}`,
      formatList('Intent.successCriteria', normalized.intent.successCriteria, 5),
      formatList('Intent.nonGoals', normalized.intent.nonGoals, 5),
      ``,
      formatList('State.facts', normalized.state.facts, 10),
      formatList('State.decisions', normalized.state.decisions, 10),
      formatList('State.assumptions', normalized.state.assumptions, 10),
      formatList('State.openLoops', normalized.state.openLoops, 10),
      ``,
      formatList('Constraints.technical', normalized.constraints.technical, 10),
      formatList('Constraints.process', normalized.constraints.process, 10),
      formatList('Constraints.policy', normalized.constraints.policy, 10),
      ``,
      formatApis(),
      formatList('Interfaces.modules', normalized.interfaces.modules, 10),
      ``,
      formatRisks(),
      formatEvidence(),
      ``,
      `History.origin: ${normalized.history.origin} | derivedFrom: ${normalized.history.derivedFrom || '(none)'} | revision: ${normalized.history.revision}`,
      `Compat.accepts: ${normalized.compat.accepts.join(', ') || '(empty)'} | downgradeStrategy: ${normalized.compat.downgradeStrategy}`,
      ``,
      `Findings.missingFields (${findings.missingFields.length})`,
      ...missingLines,
      ``,
      formatConflicts(),
      ``,
      `Transition.mode: ${applyReport.transition?.mode ?? '(none)'}`,
      `Transition.stateHash: before=${applyReport.transition?.stateHashBefore ?? '(none)'} | after=${applyReport.transition?.stateHashAfter ?? '(none)'}`,
      `Transition.modifiedDomains: ${applyReport.transition?.deltaSummary.modifiedDomains.join(', ') || '(none)'}`,
      `Transition.postApplyConflicts: ${applyReport.transition?.postApplyConflicts.length ?? 0}`,
      ``,
      `ApplyReport.counts: facts=${applyReport.counts.facts}, decisions=${applyReport.counts.decisions}, assumptions=${applyReport.counts.assumptions}, openLoops=${applyReport.counts.openLoops}, evidence=${applyReport.counts.evidence}`,
      `ApplyReport.contract: conflictHandling=${applyReport.contract.conflictHandling}`,
      `--- END DIGEST ---`,
    ].join('\n');
  }

  private buildPackagePayloadFromSnapshot(snapshot: any) {
    const now = new Date().toISOString();
    const v2 = snapshot?.snapshotV2;

    return {
      manifest: {
        schemaVersion: 'tpkg-0.1',
        createdAt: now,
        title: v2?.title || null,
        description: v2?.description || null,
      },
      intent: {
        text: v2?.intent || snapshot?.anchorIntent?.description || '',
      },
      state: {
        facts: Array.isArray(v2?.facts) ? v2.facts : [],
        decisions: Array.isArray(v2?.decisions) ? v2.decisions : [],
        assumptions: Array.isArray(v2?.assumptions) ? v2.assumptions : [],
        openLoops: Array.isArray(v2?.openLoops) ? v2.openLoops : [],
      },
      constraints: {
        interfaces: Array.isArray(v2?.interfaces) ? v2.interfaces : [],
      },
      risks: Array.isArray(v2?.risks) ? v2.risks : [],
      evidence: Array.isArray(v2?.evidence) ? v2.evidence : [],
      raw: { snapshotV1: snapshot },
    };
  }

  private makePayloadSummary(payload: any) {
    const facts = Array.isArray(payload?.state?.facts) ? payload.state.facts.length : 0;
    const decisions = Array.isArray(payload?.state?.decisions) ? payload.state.decisions.length : 0;
    const assumptions = Array.isArray(payload?.state?.assumptions) ? payload.state.assumptions.length : 0;
    const openLoops = Array.isArray(payload?.state?.openLoops) ? payload.state.openLoops.length : 0;
    const evidence = Array.isArray(payload?.evidence) ? payload.evidence.length : 0;

    return `facts=${facts}, decisions=${decisions}, assumptions=${assumptions}, openLoops=${openLoops}, evidence=${evidence}`;
  }

  private buildApplySystemPrompt(payload: any, mode: ApplyMode) {
    const modeInstruction =
      mode === 'constrain'
        ? [
            `【Apply Mode: CONSTRAIN】`,
            `- 必须遵守 constraints/interfaces 中的约束；不得违反 assumptions`,
            `- 若 userQuestion 冲突：指出冲突→给替代方案→再回答`,
          ].join('\n')
        : mode === 'review'
        ? [
            `【Apply Mode: REVIEW】`,
            `- 先检查 userQuestion 是否与 facts/decisions/assumptions 冲突`,
            `- 列缺口（缺什么会影响输出）`,
            `- 给当前最佳回答 + 明确不确定性`,
          ].join('\n')
        : [
            `【Apply Mode: BOOTSTRAP】`,
            `- 先用 package 做现状简报（3~6条，必须复述 facts/decisions/constraints）`,
            `- 再回答 userQuestion`,
            `- 若缺口，最多 3 个澄清问题，并说明影响`,
          ].join('\n');

    const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
    const intent = clip(String(payload?.intent?.text || ''), 1200);

    return [
      `你在执行“任务迁移包（Task Package）Apply”。你必须把 package 当作“当前事实状态”来继续推进。`,
      ``,
      `【Hard Rules】`,
      `1) 不要索要原对话/上下文窗口。`,
      `2) 若信息不足：最多 3 个澄清问题，并说明缺口影响什么。`,
      `3) 不能否认或弱化 package 中已有 facts/decisions/constraints。`,
      ``,
      `【Package Manifest】`,
      JSON.stringify(payload?.manifest || {}, null, 2),
      ``,
      `【Intent】`,
      intent || '(empty)',
      ``,
      `【State】`,
      JSON.stringify(payload?.state || {}, null, 2),
      ``,
      `【Constraints】`,
      JSON.stringify(payload?.constraints || {}, null, 2),
      ``,
      `【Risks】`,
      JSON.stringify(payload?.risks || [], null, 2),
      ``,
      `【Evidence】(may be partial, treat as evidence, not story)`,
      JSON.stringify((payload?.evidence || []).slice(0, 10), null, 2),
      ``,
      modeInstruction,
      ``,
      `请使用用户提问的语言回答。`,
    ].join('\n');
  }

  private buildApplyReport(payload: any, mode: ApplyMode, userQuestion: string) {
    const facts = Array.isArray(payload?.state?.facts) ? payload.state.facts.length : 0;
    const decisions = Array.isArray(payload?.state?.decisions) ? payload.state.decisions.length : 0;
    const assumptions = Array.isArray(payload?.state?.assumptions) ? payload.state.assumptions.length : 0;
    const openLoops = Array.isArray(payload?.state?.openLoops) ? payload.state.openLoops.length : 0;
    const evidence = Array.isArray(payload?.evidence) ? payload.evidence.length : 0;

    return {
      mode,
      userQuestionPreview: String(userQuestion || '').slice(0, 240),
      counts: { facts, decisions, assumptions, openLoops, evidence },
      usedFields: ['manifest', 'intent', 'state', 'constraints', 'risks', 'evidence'],
      notes: ['applyReport is structural; conflict detection is planned in next iteration (P2-B+)'],
    };
  }
}
