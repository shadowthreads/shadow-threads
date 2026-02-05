import { LLMProvider, Prisma, TaskPackageStatus } from '@prisma/client';
import { prisma, logger } from '../utils';
import { LLMService } from './llm.service';
import { UserService } from './user.service';
import { normalizeTaskPackagePayload, type ApplyMode, type NormalizedTaskPackage, type NormalizeFindings } from './task-package.normalize';
import { detectConflicts, type Conflict } from './task-package.conflicts';
import { buildTaskPackagePayloadV2 } from './task-package.payload';

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
};

export type CreateRevisionInput = {
  payload: any;
  summary?: string;
  schemaVersion?: string;
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
};

type ErrCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'NO_REVISION'
  | 'INVALID_INPUT';

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; code: ErrCode };
type Result<T> = Ok<T> | Err;

const SERVICE_ERROR_CODES = new Set<ErrCode>(['NOT_FOUND', 'FORBIDDEN', 'NO_REVISION', 'INVALID_INPUT']);

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
    if (typeof rawCode === 'string' && rawCode.startsWith('LLM_')) return 'INVALID_INPUT';
    if (rawCode === 'API_KEY_NOT_FOUND') return 'INVALID_INPUT';
  }
  return 'INVALID_INPUT';
}

export class TaskPackageService {
  private llmService = new LLMService();
  private userService = new UserService();

  /**
   * 列表
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
   * 获取归属校验后的 package（含 currentRevision）
   */
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
   * 从 StateSnapshot 生成一个 TaskPackage（脱钩实体）
   * - 生成 rev=0
   * - package.currentRevisionId 指向 rev=0
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
   * 导入一个 package（JSON）
   */
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
   * 创建新 revision（rev+1），并切 currentRevision
   */
  async createRevision(
    userId: string,
    packageId: string,
    input: CreateRevisionInput
  ): Promise<Result<{ pkg: any; revision: any }>> {
    try {
      const pkg = await this.getOwned(userId, packageId);
      if (!pkg.currentRevision) throwServiceError('NO_REVISION');

      const nextRev = (pkg.currentRevision.rev ?? 0) + 1;
      const payload = input.payload ?? {};

      const out = await prisma.$transaction(async (tx) => {
        const rev = await tx.taskPackageRevision.create({
          data: {
            packageId,
            rev: nextRev,
            schemaVersion: String(input.schemaVersion || payload?.manifest?.schemaVersion || 'tpkg-0.1'),
            payload: payload as Prisma.InputJsonValue,
            summary: input.summary ?? this.makePayloadSummary(payload),
          },
        });

        const updated = await tx.taskPackage.update({
          where: { id: packageId },
          data: { currentRevisionId: rev.id },
          include: { currentRevision: true },
        });

        return { pkg: updated, revision: rev };
      });

      return { ok: true, data: out };
    } catch (err) {
      return { ok: false, code: normalizeServiceError(err) };
    }
  }

  /**
   * 导出当前 revision 的 payload
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
   * Apply：输入 packageId + userQuestion → LLM 回复 + applyReport
   */
  async applyPackage(userId: string, packageId: string, input: ApplyPackageInput): Promise<Result<any>> {
    try {
      const pkg = await this.getOwned(userId, packageId);
      if (!pkg.currentRevision) throwServiceError('NO_REVISION');

      const payload = pkg.currentRevision.payload as any;
      const mode = (input.mode || 'bootstrap') as ApplyMode;

      const provider: LLMProvider = input.provider || LLMProvider.OPENAI;
      const model: string = input.model || 'gpt-4o-mini';
      const apiKey = await this.userService.getDecryptedApiKey(userId, provider);

      const { normalized, findings } = normalizeTaskPackagePayload(payload, {
        revision: pkg.currentRevision.rev ?? 0,
        sourceSnapshotId: pkg.sourceSnapshotId,
      });
      const conflicts = detectConflicts({ userQuestion: input.userQuestion, normalized, mode });
      const applyReport = this.buildApplyReportV2(normalized, mode, findings, conflicts);
      const systemPrompt = this.buildApplySystemPromptV2(normalized, mode, findings, conflicts, applyReport);

      const llmResp = await this.llmService.complete({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input.userQuestion },
        ],
        config: { provider, model, apiKey },
        route: 'package_apply',
      } as any);

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
   * 兼容旧 router：buildApplyPayload(payload, mode) 这个名字
   * 现在内部就是 buildApplySystemPrompt
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
    conflicts: Conflict[]
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
