import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
const source = resolve(process.env.DSH_SOURCE_ROOT);
const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export default defineConfig({
  root: resolve(import.meta.dirname, '../..'),
  test: {
    include: [resolve(import.meta.dirname, 'record.test.mjs')],
    server: { deps: { external: [new RegExp(`^${escaped}/(?:packages|vendor)/`)] } },
    testTimeout: 180000, hookTimeout: 30000, fileParallelism: false, maxWorkers: 1,
  },
});
