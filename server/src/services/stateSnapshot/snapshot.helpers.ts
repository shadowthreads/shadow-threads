/**
 * StateSnapshot helpers (pure functions)
 * - 解析 v1
 * - v2 baseline 生成
 * - evidence digest / v2 格式化
 */

export type SnapshotV1 = {
  anchorIntent?: {
    description?: any;
    openQuestions?: any;
    openLoops?: any;
    questions?: any;
    lastEvolvedAt?: string;
  };
  effectiveContext?: {
    strategy?: any;
  };
  thoughtTrajectory?: {
    conclusions?: any;
  };
  continuationContract?: {
    assumptions?: any;
  };
};

export type EvidenceItem = {
  id: string;
  type: 'selection' | 'context' | 'delta_user' | 'delta_assistant';
  text: string;
  source?: any;
  meta?: any;
};

export type SnapshotV2 = {
  version: 'v2';
  title?: string;
  intent: string;
  tags?: string[];

  evidence?: EvidenceItem[];

  facts: Array<{ id: string; text: string; source?: string }>;
  assumptions: Array<{ id: string; text: string; confidence?: 'low' | 'med' | 'high' }>;
  decisions: Array<{ id: string; decision: string; rationale?: string }>;
  openLoops: Array<{ id: string; question: string; status?: 'open' | 'resolved'; owner?: 'user' | 'assistant' }>;

  interfaces?: Array<{
    name: string;
    inputs?: string[];
    outputs?: string[];
    constraints?: string[];
  }>;

  risks?: Array<{ id: string; risk: string; mitigation?: string }>;

  retrievalHints?: { keywords?: string[]; entities?: string[] };
};

export function uniqLimit(arr: string[], limit: number) {
  return Array.from(new Set(arr.map((x) => String(x).trim()).filter(Boolean))).slice(0, limit);
}

export function genV2Id(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

export function readV1Fields(snapAny: any) {
  const raw = snapAny || {};
  const snap = raw as SnapshotV1;

  const asTrimString = (v: any): string => {
    if (typeof v === 'string') return v.trim();
    if (v && typeof v === 'object') {
      const cands = [v.description, v.text, v.value, v.content, v.intent, v.title];
      for (const c of cands) {
        if (typeof c === 'string' && c.trim()) return c.trim();
      }
    }
    return '';
  };

  const asStringArray = (v: any): string[] => {
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    if (v && typeof v === 'object') {
      const cands = [v.items, v.values, v.list, v.data];
      for (const c of cands) {
        if (Array.isArray(c)) return c.map((x) => String(x).trim()).filter(Boolean);
      }
    }
    return [];
  };

  const anchorDesc =
    asTrimString((snap as any)?.anchorIntent?.description) ||
    asTrimString((snap as any)?.anchorIntent) ||
    asTrimString((raw as any)?.anchorDesc) ||
    asTrimString((raw as any)?.intent);

  const strategy =
    asTrimString((snap as any)?.effectiveContext?.strategy) ||
    asTrimString((snap as any)?.effectiveContext) ||
    'UNKNOWN';

  const conclusions =
    asStringArray((snap as any)?.thoughtTrajectory?.conclusions) ||
    asStringArray((snap as any)?.thoughtTrajectory) ||
    asStringArray((raw as any)?.conclusions);

  const assumptions =
    asStringArray((snap as any)?.continuationContract?.assumptions) ||
    asStringArray((snap as any)?.continuationContract) ||
    asStringArray((raw as any)?.assumptions);

  const openQuestions =
    asStringArray((snap as any)?.anchorIntent?.openQuestions).length
      ? asStringArray((snap as any)?.anchorIntent?.openQuestions)
      : asStringArray((snap as any)?.anchorIntent?.openLoops).length
      ? asStringArray((snap as any)?.anchorIntent?.openLoops)
      : asStringArray((snap as any)?.anchorIntent?.questions);

  const snapshotV2 = (raw as any)?.snapshotV2 as SnapshotV2 | undefined;

  return { snap, anchorDesc, strategy, conclusions, assumptions, openQuestions, snapshotV2 };
}

/**
 * baseline：从 v1 生成一个“够用但不花哨”的 v2（保证后续可演进）
 * 当 conclusions/assumptions/openQuestions 为空但 anchorDesc 很长时，启发式抽取 facts/constraints/decisions
 */
export function buildV2BaselineFromV1(params: {
  anchorDesc: string;
  conclusions: string[];
  assumptions: string[];
  openQuestions: string[];
}): SnapshotV2 {
  const { anchorDesc, conclusions, assumptions, openQuestions } = params;

  const facts: Array<{ id: string; text: string; source?: string }> = [];
  const decisions: Array<{ id: string; decision: string; rationale?: string }> = [];
  const constraints: string[] = [];

  const clean = (s: string) => String(s || '').replace(/\s+/g, ' ').trim();

  const v1Empty =
    (!Array.isArray(conclusions) || conclusions.length === 0) &&
    (!Array.isArray(assumptions) || assumptions.length === 0) &&
    (!Array.isArray(openQuestions) || openQuestions.length === 0);

  const anchorText = clean(anchorDesc);

  if (v1Empty && anchorText.length >= 120) {
    const chunks = anchorText
      .split(/[\n\r]+|[。！？；;]+/)
      .map((x) => clean(x))
      .filter((x) => x.length >= 8 && x.length <= 220);

    for (const c of chunks) {
      if (facts.length >= 8) break;
      facts.push({ id: genV2Id('f'), text: c, source: 'anchorDesc' });
    }

    const negRe = /(不做|不支持|不包含|排除|避免|不需要|不会做|不考虑)/;
    for (const c of chunks) {
      if (constraints.length >= 6) break;
      if (negRe.test(c)) constraints.push(c);
    }

    const decRe = /(必须|只支持|范围冻结|里程碑|验收标准|目标|不动摇|最终交付)/;
    for (const c of chunks) {
      if (decisions.length >= 6) break;
      if (decRe.test(c)) decisions.push({ id: genV2Id('d'), decision: c });
    }
  }

  const v2: SnapshotV2 = {
    version: 'v2',
    intent: anchorText || '(empty)',
    facts,

    assumptions: (assumptions || []).slice(0, 20).map((t) => ({
      id: genV2Id('a'),
      text: clean(String(t)),
      confidence: 'med',
    })),

    decisions: decisions.length
      ? decisions
      : (conclusions || []).slice(0, 20).map((t) => ({
          id: genV2Id('d'),
          decision: clean(String(t)),
        })),

    openLoops: (openQuestions || []).slice(0, 20).map((q) => ({
      id: genV2Id('q'),
      question: clean(String(q)),
      status: 'open',
      owner: 'user',
    })),

    interfaces: constraints.length
      ? [
          {
            name: 'MVP Constraints',
            constraints,
          },
        ]
      : [],

    risks: [],

    retrievalHints: {
      keywords: uniqLimit(anchorText.split(/[\s,，。；;、/\\|]+/).filter(Boolean), 12),
    },
  };

  return v2;
}

export function formatEvidenceDigest(v2: any): string {
  const evidence = Array.isArray(v2?.evidence) ? v2.evidence : [];
  if (!evidence.length) return '(evidence: none)';

  const clean = (s: any) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

  const sel = evidence.filter((e: any) => String(e?.type) === 'selection');
  const ctx = evidence.filter((e: any) => String(e?.type) === 'context');
  const du = evidence.filter((e: any) => String(e?.type) === 'delta_user');
  const da = evidence.filter((e: any) => String(e?.type) === 'delta_assistant');

  const pick = (arr: any[], n: number) =>
    arr.slice(0, n).map((e: any, i: number) => {
      const t = clean(e?.text);
      return `  ${i + 1}. ${clip(t, 260)}`;
    });

  return [
    `【Evidence Digest】(compressed, do NOT ignore)`,
    `- counts: selection=${sel.length}, context=${ctx.length}, delta_user=${du.length}, delta_assistant=${da.length}, total=${evidence.length}`,
    `- selection (top 4):`,
    sel.length ? pick(sel, 4).join('\n') : `  (none)`,
    `- context (top 3):`,
    ctx.length ? pick(ctx, 3).join('\n') : `  (none)`,
    `- delta_user (last 2):`,
    du.length ? pick(du.slice(-2), 2).join('\n') : `  (none)`,
    `- delta_assistant (last 2):`,
    da.length ? pick(da.slice(-2), 2).join('\n') : `  (none)`,
  ].join('\n');
}

export function formatSnapshotV2(v2: any): string {
  if (!v2) return '(snapshotV2 missing)';

  const facts = Array.isArray(v2.facts) ? v2.facts : [];
  const assumptions2 = Array.isArray(v2.assumptions) ? v2.assumptions : [];
  const decisions = Array.isArray(v2.decisions) ? v2.decisions : [];
  const openLoops = Array.isArray(v2.openLoops) ? v2.openLoops : [];
  const interfaces = Array.isArray(v2.interfaces) ? v2.interfaces : [];
  const risks = Array.isArray(v2.risks) ? v2.risks : [];

  const fmt = (x: any) => String(x ?? '').trim();

  return [
    `- intent: ${fmt(v2.intent) || '(empty)'}`,
    `- facts:`,
    facts.length ? facts.slice(0, 12).map((x: any, i: number) => `  ${i + 1}. ${fmt(x?.text)}`).join('\n') : `  (none)`,
    `- assumptions:`,
    assumptions2.length
      ? assumptions2.slice(0, 12).map((x: any, i: number) => `  ${i + 1}. ${fmt(x?.text)}`).join('\n')
      : `  (none)`,
    `- decisions:`,
    decisions.length
      ? decisions.slice(0, 12).map((x: any, i: number) => `  ${i + 1}. ${fmt(x?.decision)}`).join('\n')
      : `  (none)`,
    `- openLoops:`,
    openLoops.length
      ? openLoops.slice(0, 12).map((x: any, i: number) => `  ${i + 1}. ${fmt(x?.question)}`).join('\n')
      : `  (none)`,
    `- interfaces.constraints:`,
    interfaces.length
      ? interfaces
          .slice(0, 8)
          .map((it: any) => {
            const name = fmt(it?.name) || 'unnamed';
            const constraints = Array.isArray(it?.constraints) ? it.constraints.map((c: any) => fmt(c)).filter(Boolean) : [];
            return `  - ${name}: ${constraints.length ? constraints.join('; ') : '(none)'}`;
          })
          .join('\n')
      : `  (none)`,
    `- risks:`,
    risks.length
      ? risks
          .slice(0, 8)
          .map((r: any, i: number) => {
            const risk = fmt(r?.risk) || '(empty)';
            const mitigation = fmt(r?.mitigation);
            return `  ${i + 1}. ${risk}${mitigation ? ` (mitigation: ${mitigation})` : ''}`;
          })
          .join('\n')
      : `  (none)`,
  ].join('\n');
}