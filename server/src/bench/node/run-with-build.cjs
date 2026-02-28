const path = require('path');
const { spawnSync } = require('child_process');

function runBuild(serverRoot) {
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || 'cmd.exe';
    return spawnSync(comspec, ['/d', '/s', '/c', 'npm run build'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
      windowsHide: true,
    });
  }

  return spawnSync('npm', ['run', 'build'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  });
}

function runRunner(serverRoot) {
  return spawnSync(process.execPath, ['src/bench/node/runner.cjs'], {
    cwd: serverRoot,
    stdio: 'inherit',
  });
}

function main() {
  const serverRoot = path.resolve(__dirname, '../../..');
  const buildResult = runBuild(serverRoot);
  const buildSucceeded =
    buildResult.error == null && typeof buildResult.status === 'number' && buildResult.status === 0;

  if (!buildSucceeded) {
    process.stdout.write('BENCH_BUILD_FAILED\n');
    process.exit(1);
  }

  const runnerResult = runRunner(serverRoot);
  if (runnerResult.status !== 0) {
    process.exit(typeof runnerResult.status === 'number' ? runnerResult.status : 1);
  }
}

if (require.main === module) {
  main();
}
