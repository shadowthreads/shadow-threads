import fs from 'fs';
import path from 'path';

const DOMAIN_ORDER = ['facts', 'decisions', 'constraints', 'risks', 'assumptions'] as const;
const BASELINE_ORDER = ['B1_CORE_BEST_EFFORT', 'B1_CORE_STRICT', 'B1_PIPELINE'] as const;

type DomainName = (typeof DOMAIN_ORDER)[number];
type BaselineName = (typeof BASELINE_ORDER)[number];
type TaskCategory = 'T1' | 'T2';

type DomainCounts = {
  added: number;
  removed: number;
  modified: number;
};

type DeltaSummary = {
  counts: Record<DomainName, DomainCounts>;
  hasCollisions: boolean;
  assumptionsDerived: boolean;
  modifiedDomains: DomainName[];
};

export type BenchResultRecord = {
  experiment: { id: string; ts: null };
  task: { taskId: string; category: TaskCategory; rep: number };
  baseline: {
    name: BaselineName;
    mode: 'best_effort' | 'strict' | null;
    supported: boolean;
    reason: string | null;
  };
  identity: {
    stateHashBefore: string | null;
    stateHashAfter: string | null;
    targetHash: string | null;
  };
  delta: {
    summary: DeltaSummary | null;
  };
  transition: {
    conflictCount: number;
    postApplyConflictCount: number;
  };
  drift: {
    equalsTargetHash: boolean;
    distanceCounts: Record<DomainName, DomainCounts>;
    distanceCountsSum: number;
  };
  assertions: {
    passed: boolean;
    failed: string[];
  };
};

type SummaryRow = {
  taskId: string;
  category: TaskCategory;
  baseline: {
    name: BaselineName;
    mode: 'best_effort' | 'strict' | null;
    supported: boolean;
    reason: string | null;
  };
  repetitions: number;
  replayPassRate: null;
  hashStabilityRate: number | null;
  avgConflictCount: number | null;
  avgPostApplyConflictCount: number | null;
  avgDistanceCountsSum: number | null;
  equalsTargetRate: number | null;
  assertionPassRate: number | null;
};

export type BenchSummary = {
  schema: 'bench-summary-1';
  experimentId: 'EVAL-1';
  generatedAt: null;
  baselineOrder: readonly BaselineName[];
  rows: SummaryRow[];
};

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function baselineRank(name: BaselineName): number {
  const index = BASELINE_ORDER.indexOf(name);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

export function parseResultsJsonl(content: string): BenchResultRecord[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line) => JSON.parse(line) as BenchResultRecord);
}

export function evaluateResults(records: BenchResultRecord[]): BenchSummary {
  const groups = new Map<string, BenchResultRecord[]>();

  for (const record of records) {
    const key = `${record.task.taskId}::${record.baseline.name}::${record.baseline.mode ?? 'null'}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(record);
    } else {
      groups.set(key, [record]);
    }
  }

  const rows: SummaryRow[] = [];

  for (const groupRecords of groups.values()) {
    const sortedRecords = [...groupRecords].sort((a, b) => a.task.rep - b.task.rep);
    const sample = sortedRecords[0];
    const supported = sample.baseline.supported;

    const stateHashes = supported
      ? [...new Set(sortedRecords.map((record) => record.identity.stateHashAfter).filter((hash): hash is string => !!hash))]
      : [];

    rows.push({
      taskId: sample.task.taskId,
      category: sample.task.category,
      baseline: {
        name: sample.baseline.name,
        mode: sample.baseline.mode,
        supported: sample.baseline.supported,
        reason: sample.baseline.reason,
      },
      repetitions: sortedRecords.length,
      replayPassRate: null,
      hashStabilityRate: supported ? (stateHashes.length === 1 ? 1 : 0) : null,
      avgConflictCount: supported
        ? round6(average(sortedRecords.map((record) => record.transition.conflictCount)))
        : null,
      avgPostApplyConflictCount: supported
        ? round6(average(sortedRecords.map((record) => record.transition.postApplyConflictCount)))
        : null,
      avgDistanceCountsSum: supported
        ? round6(average(sortedRecords.map((record) => record.drift.distanceCountsSum)))
        : null,
      equalsTargetRate: supported
        ? round6(average(sortedRecords.map((record) => (record.drift.equalsTargetHash ? 1 : 0))))
        : null,
      assertionPassRate: supported
        ? round6(average(sortedRecords.map((record) => (record.assertions.passed ? 1 : 0))))
        : null,
    });
  }

  const sortedRows = rows.sort((a, b) => {
    return (
      compareString(a.taskId, b.taskId) ||
      baselineRank(a.baseline.name) - baselineRank(b.baseline.name) ||
      compareString(a.baseline.mode ?? '', b.baseline.mode ?? '')
    );
  });

  return {
    schema: 'bench-summary-1',
    experimentId: 'EVAL-1',
    generatedAt: null,
    baselineOrder: BASELINE_ORDER,
    rows: sortedRows,
  };
}

function formatMetric(value: number | null): string {
  return value === null ? 'null' : String(value);
}

export function renderSummaryMarkdown(summary: BenchSummary): string {
  const lines: string[] = [];
  lines.push('# Shadow Threads EVAL-1 Summary');
  lines.push('');
  lines.push('- Experiment: EVAL-1');
  lines.push('- GeneratedAt: null');
  lines.push('');

  const taskIds = [...new Set(summary.rows.map((row) => row.taskId))].sort(compareString);

  for (const taskId of taskIds) {
    const taskRows = summary.rows.filter((row) => row.taskId === taskId);
    if (taskRows.length === 0) continue;
    const category = taskRows[0].category;

    lines.push(`## ${taskId} (${category})`);
    lines.push('| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');

    const orderedRows = [...taskRows].sort((a, b) => baselineRank(a.baseline.name) - baselineRank(b.baseline.name));
    for (const row of orderedRows) {
      lines.push(
        `| ${row.baseline.name} | ${row.baseline.mode ?? 'null'} | ${row.baseline.supported} | ${formatMetric(row.hashStabilityRate)} | ${formatMetric(row.avgConflictCount)} | ${formatMetric(row.avgPostApplyConflictCount)} | ${formatMetric(row.avgDistanceCountsSum)} | ${formatMetric(row.equalsTargetRate)} | ${formatMetric(row.assertionPassRate)} |`
      );
    }

    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function runEvaluation(resultsFile: string, summaryJsonFile: string, summaryMdFile: string): BenchSummary {
  const jsonl = fs.existsSync(resultsFile) ? fs.readFileSync(resultsFile, 'utf8') : '';
  const records = parseResultsJsonl(jsonl);
  const summary = evaluateResults(records);
  const markdown = renderSummaryMarkdown(summary);

  fs.mkdirSync(path.dirname(summaryJsonFile), { recursive: true });
  fs.writeFileSync(summaryJsonFile, JSON.stringify(summary, null, 2), 'utf8');
  fs.writeFileSync(summaryMdFile, markdown, 'utf8');

  return summary;
}

function main(): void {
  const root = process.cwd();
  const resultsFile = path.resolve(root, 'bench', 'out', 'results.jsonl');
  const summaryJsonFile = path.resolve(root, 'bench', 'out', 'summary.json');
  const summaryMdFile = path.resolve(root, 'bench', 'out', 'summary.md');
  const summary = runEvaluation(resultsFile, summaryJsonFile, summaryMdFile);
  process.stdout.write(`EVAL-1 evaluator summarized ${summary.rows.length} task/baseline rows\n`);
}

if (require.main === module) {
  main();
}
