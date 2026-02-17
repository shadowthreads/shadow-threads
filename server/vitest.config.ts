import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: 'C:/dev/_cache/shadow-threads-vitest/vite',
  test: {
    cache: {
      dir: 'C:/dev/_cache/shadow-threads-vitest',
    },
    pool: 'threads',
    maxWorkers: 1,
    fileParallelism: false,
  },
});
