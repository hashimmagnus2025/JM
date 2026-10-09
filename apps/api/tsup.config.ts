import { defineConfig } from 'tsup';

export default defineConfig({
  // db/migrate + db/seed are shipped too: `node dist/db/migrate.js`, `node dist/db/seed.js` in production
  entry: ['src/server.ts', 'src/worker.ts', 'src/db/migrate.ts', 'src/db/seed.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // workspace packages are TypeScript source → inline them into the bundle
  noExternal: ['@sfm/shared'],
});
