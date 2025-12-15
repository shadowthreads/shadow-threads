/* eslint-disable no-console */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function copyFileSafe(from, to) {
  try {
    ensureDir(path.dirname(to));
    fs.copyFileSync(from, to);
  } catch (e) {
    console.warn('[build] copy failed:', from, '->', to, e?.message || e);
  }
}

function copyDirSafe(fromDir, toDir) {
  if (!fs.existsSync(fromDir)) return;
  ensureDir(toDir);
  const entries = fs.readdirSync(fromDir, { withFileTypes: true });
  for (const ent of entries) {
    const from = path.join(fromDir, ent.name);
    const to = path.join(toDir, ent.name);
    if (ent.isDirectory()) copyDirSafe(from, to);
    else copyFileSafe(from, to);
  }
}

function copyStatic() {
  ensureDir(distDir);

  // manifest
  copyFileSafe(path.join(root, 'manifest.json'), path.join(distDir, 'manifest.json'));

  // options.html
  copyFileSafe(path.join(root, 'options.html'), path.join(distDir, 'options.html'));

  // styles / icons（如存在）
  copyDirSafe(path.join(root, 'styles'), path.join(distDir, 'styles'));
  copyDirSafe(path.join(root, 'icons'), path.join(distDir, 'icons'));
}

async function build({ watch = false } = {}) {
  ensureDir(distDir);
  copyStatic();

  const ctx = await esbuild.context({
    entryPoints: {
      background: path.join(srcDir, 'background.ts'),
      content: path.join(srcDir, 'content.ts'),
      options: path.join(srcDir, 'options.ts')
    },
    bundle: true,
    outdir: distDir,
    platform: 'browser',
    target: ['chrome114', 'edge114'],
    sourcemap: true,
    format: 'iife',
    logLevel: 'info'
  });

  if (watch) {
    await ctx.watch();
    console.log('[build] watching...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('[build] done.');
  }
}

const isWatch = process.argv.includes('--watch');
build({ watch: isWatch }).catch((e) => {
  console.error(e);
  process.exit(1);
});