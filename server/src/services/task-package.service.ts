import { LLMProvider, Prisma, TaskPackageStatus } from '@prisma/client';
import { prisma, logger } from '../utils';
import { LLMService } from './llm.service';
import { UserService } from './user.service';

type ApplyMode = 'bootstrap' | 'constrain' | 'review';

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

export class TaskPackageService {
  private llmService = new LLMService();
  private userService = new UserService();

  /**
   * 从 StateSnapshot 生成一个 TaskPackage（脱钩实体）
   * - 生成 rev=0
   * - package.currentRevisionId 指向 rev=0
   */
  async createFromSnapshot(userId: string, input: CreatePackageFromSnapshotInput) {
    const snap = await prisma.stateSnapshot.findUnique({
      where: { id: input.sourceSnapshotId },
      select: { id: true, userId: true, subthreadId: true, snapshot: true }
    });

    if (!snap) {
      throw new Error('StateSnapshot not found');
    }
    if (snap.userId !== userId) {
      throw new Error('FORBIDDEN');
    }

    // ✅ payload：工业最小结构（先务实，不搞“行业范式”）
    const payload = this.buildPackagePayloadFromSnapshot(snap.snapshot);

    return await prisma.$transaction(async (tx) => {
      const pkg = await tx.taskPackage.create({
        data: {
          userId,
          sourceSnapshotId: snap.id,
          title: input.title ?? null,
          description: input.description ?? null,
          status: TaskPackageStatus.ACTIVE
        }
      });

      const rev0 = await tx.taskPackageRevision.create({
        data: {
          packageId: pkg.id,
          rev: 0,
          schemaVersion: 'tpkg-0.1',
          payload: payload as Prisma.InputJsonValue,
          summary: this.makePayloadSummary(payload)
        }
      });

      const updated = await tx.taskPackage.update({
        where: { id: pkg.id },
        data: { currentRevisionId: rev0.id }
      });

      return { pkg: updated, revision: rev0 };
    });
  }

  /**
   * 导入一个 package（JSON）
   */
  async importPackage(userId: string, input: ImportPackageInput) {
    const payload = input.payload ?? {};
    return await prisma.$transaction(async (tx) => {
      const pkg = await tx.taskPackage.create({
        data: {
          userId,
          title: input.title ?? (payload?.manifest?.title ?? null),
          description: input.description ?? (payload?.manifest?.description ?? null),
          status: TaskPackageStatus.ACTIVE
        }
      });

      const rev0 = await tx.taskPackageRevision.create({
        data: {
          packageId: pkg.id,
          rev: 0,
          schemaVersion: String(payload?.manifest?.schemaVersion || 'tpkg-0.1'),
          payload: payload as Prisma.InputJsonValue,
          summary: this.makePayloadSummary(payload)
        }
      });

      const updated = await tx.taskPackage.update({
        where: { id: pkg.id },
        data: { currentRevisionId: rev0.id }
      });

      return { pkg: updated, revision: rev0 };
    });
  }

  /**
   * 导出当前 revision 的 payload
   */
  async exportPackage(userId: string, packageId: string) {
    const pkg = await prisma.taskPackage.findUnique({
      where: { id: packageId },
      include: { currentRevision: true }
    });

    if (!pkg) throw new Error('NOT_FOUND');
    if (pkg.userId !== userId) throw new Error('FORBIDDEN');
    if (!pkg.currentRevision) throw new Error('NO_REVISION');

    return {
      package: {
        id: pkg.id,
        title: pkg.title,
        description: pkg.description,
        status: pkg.status,
        createdAt: pkg.createdAt,
        updatedAt: pkg.updatedAt
      },
      revision: {
        id: pkg.currentRevision.id,
        rev: pkg.currentRevision.rev,
        schemaVersion: pkg.currentRevision.schemaVersion,
        createdAt: pkg.currentRevision.createdAt
      },
      payload: pkg.currentRevision.payload
    };
  }

  /**
   * Apply：输入 packageId + userQuestion → LLM 回复 + applyReport
   */
  async applyPackage(userId: string, packageId: string, input: ApplyPackageInput) {
    const pkg = await prisma.taskPackage.findUnique({
      where: { id: packageId },
      include: { currentRevision: true }
    });

    if (!pkg) return { ok: false as const, code: 'NOT_FOUND' as const };
    if (pkg.userId !== userId) return { ok: false as const, code: 'FORBIDDEN' as const };
    if (!pkg.currentRevision) return { ok: false as const, code: 'NO_REVISION' as const };

    const payload = pkg.currentRevision.payload as any;

    const mode = (input.mode || 'bootstrap') as ApplyMode;
    const provider: LLMProvider = input.provider || LLMProvider.OPENAI;
    const model: string = input.model || 'gpt-4o-mini';
    const apiKey = await this.userService.getDecryptedApiKey(userId, provider);

    const systemPrompt = this.buildApplySystemPrompt(payload, mode);

    const llmResp = await this.llmService.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input.userQuestion }
      ],
      config: { provider, model, apiKey },
      route: 'package_apply'
    } as any);

    const applyReport = this.buildApplyReport(payload, mode, input.userQuestion);

    return {
      ok: true as const,
      data: {
        packageId: pkg.id,
        revisionId: pkg.currentRevision.id,
        revisionRev: pkg.currentRevision.rev,
        provider,
        model,
        assistantReply: { content: llmResp.content },
        applyReport
      }
    };
  }

  // -----------------------
  // helpers (pure-ish)
  // -----------------------

  private buildPackagePayloadFromSnapshot(snapshot: any) {
    // 先务实：把 snapshot（v1+可选v2）封装成 tpkg-0.1 的基础结构
    const now = new Date().toISOString();
    const v2 = snapshot?.snapshotV2;

    return {
      manifest: {
        schemaVersion: 'tpkg-0.1',
        createdAt: now,
        title: v2?.title || null
      },
      intent: {
        text: v2?.intent || snapshot?.anchorIntent?.description || ''
      },
      state: {
        facts: Array.isArray(v2?.facts) ? v2.facts : [],
        decisions: Array.isArray(v2?.decisions) ? v2.decisions : [],
        assumptions: Array.isArray(v2?.assumptions) ? v2.assumptions : [],
        openLoops: Array.isArray(v2?.openLoops) ? v2.openLoops : []
      },
      constraints: {
        interfaces: Array.isArray(v2?.interfaces) ? v2.interfaces : []
      },
      risks: Array.isArray(v2?.risks) ? v2.risks : [],
      evidence: Array.isArray(v2?.evidence) ? v2.evidence : [],
      raw: {
        snapshotV1: snapshot
      }
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
            `- 若 userQuestion 冲突：指出冲突→给替代方案→再回答`
          ].join('\n')
        : mode === 'review'
        ? [
            `【Apply Mode: REVIEW】`,
            `- 先检查 userQuestion 是否与 facts/decisions/assumptions 冲突`,
            `- 列缺口（缺什么会影响输出）`,
            `- 给当前最佳回答 + 明确不确定性`
          ].join('\n')
        : [
            `【Apply Mode: BOOTSTRAP】`,
            `- 先用 package 做现状简报（3~6条，必须复述 facts/decisions/constraints）`,
            `- 再回答 userQuestion`,
            `- 若缺口，最多 3 个澄清问题，并说明影响`
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
      `请使用用户提问的语言回答。`
    ].join('\n');
  }

  private buildApplyReport(payload: any, mode: ApplyMode, userQuestion: string) {
    // 工业上：applyReport 先做“结构性可观测”，不做玄学评分
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
      notes: [
        'applyReport is structural; conflict detection is planned in next iteration (P2-B+)'
      ]
    };
  }
}