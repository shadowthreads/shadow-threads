import type { NormalizedTaskPackage, ApplyMode } from './task-package.normalize';

export type Conflict = {
  type: 'CONSTRAINT_VIOLATION' | 'NONGOAL_REQUEST' | 'ASSUMPTION_TENSION';
  field: string;
  description: string;
  severity: 'low' | 'med' | 'high';
};

type DetectConflictsInput = {
  userQuestion: string;
  normalized: NormalizedTaskPackage;
  mode: ApplyMode;
};

const MIN_LEN_STRICT = 6;
const MIN_LEN_ASSUMPTION = 12;

function addConflictsFromList(params: {
  conflicts: Conflict[];
  questionLower: string;
  items: string[];
  fieldPrefix: string;
  type: Conflict['type'];
  severity: Conflict['severity'];
  minLen: number;
}) {
  const { conflicts, questionLower, items, fieldPrefix, type, severity, minLen } = params;
  items.forEach((item, idx) => {
    const text = String(item || '').trim();
    if (!text || text.length < minLen) return;
    if (questionLower.includes(text.toLowerCase())) {
      conflicts.push({
        type,
        field: `${fieldPrefix}[${idx}]`,
        description: `User question mentions: "${text}"`,
        severity,
      });
    }
  });
}

export function detectConflicts(input: DetectConflictsInput): Conflict[] {
  const questionLower = String(input.userQuestion || '').toLowerCase();
  const conflicts: Conflict[] = [];

  addConflictsFromList({
    conflicts,
    questionLower,
    items: input.normalized.constraints.technical,
    fieldPrefix: 'constraints.technical',
    type: 'CONSTRAINT_VIOLATION',
    severity: 'high',
    minLen: MIN_LEN_STRICT,
  });
  addConflictsFromList({
    conflicts,
    questionLower,
    items: input.normalized.constraints.process,
    fieldPrefix: 'constraints.process',
    type: 'CONSTRAINT_VIOLATION',
    severity: 'high',
    minLen: MIN_LEN_STRICT,
  });
  addConflictsFromList({
    conflicts,
    questionLower,
    items: input.normalized.constraints.policy,
    fieldPrefix: 'constraints.policy',
    type: 'CONSTRAINT_VIOLATION',
    severity: 'high',
    minLen: MIN_LEN_STRICT,
  });

  addConflictsFromList({
    conflicts,
    questionLower,
    items: input.normalized.intent.nonGoals,
    fieldPrefix: 'intent.nonGoals',
    type: 'NONGOAL_REQUEST',
    severity: 'med',
    minLen: MIN_LEN_STRICT,
  });

  if (input.mode === 'review') {
    addConflictsFromList({
      conflicts,
      questionLower,
      items: input.normalized.state.assumptions,
      fieldPrefix: 'state.assumptions',
      type: 'ASSUMPTION_TENSION',
      severity: 'low',
      minLen: MIN_LEN_ASSUMPTION,
    });
  }

  return conflicts;
}
