const fs = require('fs');
const path = require('path');

function makeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireFromCandidates(candidates) {
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    return require(candidate);
  }
  throw makeError('E_BENCH_UNSUPPORTED', 'Bench requires built dist algebra exports');
}

const root = path.resolve(__dirname, '../../../');

const algebraIndex = requireFromCandidates([
  path.join(root, 'dist', 'algebra', 'index.js'),
  path.join(root, 'dist', 'src', 'algebra', 'index.js'),
]);

const algebraKey = requireFromCandidates([
  path.join(root, 'dist', 'algebra', 'semanticDiff', 'key.js'),
  path.join(root, 'dist', 'src', 'algebra', 'semanticDiff', 'key.js'),
]);

const diffState = algebraIndex.diffState;
const applyDelta = algebraIndex.applyDelta;
const detectConflicts = algebraIndex.detectConflicts;
const stableHash = algebraIndex.stableHash || algebraKey.stableHash;

if (
  typeof diffState !== 'function' ||
  typeof applyDelta !== 'function' ||
  typeof detectConflicts !== 'function' ||
  typeof stableHash !== 'function'
) {
  throw makeError('E_BENCH_UNSUPPORTED', 'Bench requires built dist algebra exports');
}

module.exports = {
  diffState,
  applyDelta,
  detectConflicts,
  stableHash,
};
