import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // workspace packages are TypeScript source → inline them into the bundle
  noExternal: ['@sfm/shared'],
});
