const { compareStrings, computeLineCol, stripBomFromText } = require('./validate-fixtures.cjs');

function run() {
  const sorted = ['zeta', 'alpha', 'beta'].sort(compareStrings).join(',');
  if (sorted !== 'alpha,beta,zeta') return false;

  const sample = 'line1\n  line2\nline3';
  const pos = sample.indexOf('l', 8);
  const lc = computeLineCol(sample, pos);
  if (lc.line !== 2 || lc.col !== 3 || lc.lineText !== '  line2') return false;

  const withBom = '\uFEFF{"ok":true}';
  const stripped = stripBomFromText(withBom);
  if (stripped !== '{"ok":true}') return false;

  return true;
}

function main() {
  if (!run()) {
    process.stdout.write('BENCH_NODE_SELFTEST_FAIL\n');
    process.exit(1);
  }
  process.stdout.write('BENCH_NODE_SELFTEST_OK\n');
}

if (require.main === module) {
  main();
}
