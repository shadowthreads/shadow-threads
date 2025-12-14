/**
 * Shadow Threads Extension Build Script
 * 使用 esbuild 打包扩展
 */

const esbuild = require('esbuild');
const path = require('path');

const isWatch = process.argv.includes('--watch');

// 通用构建配置
const commonConfig = {
  bundle: true,
  format: 'iife',
  target: ['chrome90', 'firefox90', 'edge90'],
  sourcemap: process.env.NODE_ENV !== 'production',
  minify: process.env.NODE_ENV === 'production',
};

// Content Script 构建
const contentBuild = {
  ...commonConfig,
  entryPoints: ['src/content.ts'],
  outfile: 'dist/content.js',
};

// Background Service Worker 构建
const backgroundBuild = {
  ...commonConfig,
  entryPoints: ['src/background.ts'],
  outfile: 'dist/background.js',
};

async function build() {
  try {
    if (isWatch) {
      // Watch 模式
      const ctxContent = await esbuild.context(contentBuild);
      const ctxBackground = await esbuild.context(backgroundBuild);
      
      await Promise.all([
        ctxContent.watch(),
        ctxBackground.watch()
      ]);
      
      console.log('👀 Watching for changes...');
    } else {
      // 单次构建
      await Promise.all([
        esbuild.build(contentBuild),
        esbuild.build(backgroundBuild)
      ]);
      
      console.log('✅ Build completed!');
      console.log('   - dist/content.js');
      console.log('   - dist/background.js');
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();
