const fs = require('fs');
const path = require('path');

const { diffState, applyDelta, stableHash } = require('./algebra-bridge.cjs');
const { compareStrings, stripBomFromText } = require('./validate-fixtures.cjs');

function fail() {
  const error = new Error('Bench smoke failed');
  error.code = 'E_BENCH_SMOKE_FAILED';
  throw error;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toDomainState(value) {
  const record = asRecord(value);
  return {
    facts: Array.isArray(record.facts) ? record.facts : [],
    decisions: Array.isArray(record.decisions) ? record.decisions : [],
    constraints: Array.isArray(record.constraints) ? record.constraints : [],
    risks: Array.isArray(record.risks) ? record.risks : [],
    assumptions: Array.isArray(record.assumptions) ? record.assumptions : [],
  };
}

function main() {
  const root = path.resolve(__dirname, '../../..');
  const tasksDir = path.join(root, 'bench', 'tasks');
  const fixtures = fs
    .readdirSync(tasksDir)
    .filter((name) => name.endsWith('.json'))
    .sort(compareStrings);

  if (fixtures.length === 0) {
    fail();
  }

  const firstFile = fixtures[0];
  const text = stripBomFromText(fs.readFileSync(path.join(tasksDir, firstFile), 'utf8'));
  const fixtureRaw = JSON.parse(text);
  const fixture = asRecord(fixtureRaw);

  const taskId = typeof fixture.taskId === 'string' ? fixture.taskId : null;
  const baseState = toDomainState(fixture.baseState);
  const targetState = fixture.targetState === undefined ? baseState : toDomainState(fixture.targetState);

  if (!taskId) {
    fail();
  }

  const delta = diffState(baseState, targetState);
  const transition = applyDelta(baseState, delta, { mode: 'best_effort' });
  const line = {
    taskId,
    baseline: 'B1_CORE_BEST_EFFORT',
    stateHashAfter: stableHash(transition.nextState),
    conflictCount: Array.isArray(transition.conflicts) ? transition.conflicts.length : NaN,
  };

  if (
    typeof line.taskId !== 'string' ||
    typeof line.baseline !== 'string' ||
    typeof line.stateHashAfter !== 'string' ||
    line.stateHashAfter.length === 0 ||
    typeof line.conflictCount !== 'number' ||
    Number.isNaN(line.conflictCount)
  ) {
    fail();
  }

  process.stdout.write('BENCH_SMOKE_OK\n');
}

main();
