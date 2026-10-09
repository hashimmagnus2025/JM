import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // integration suites share ONE database and clear collections: never run them side by side
    fileParallelism: !process.env.MONGO_URI,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts', 'src/lib/**/*.ts', 'src/modules/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/index.ts',
        'src/**/ports.ts',
        'src/**/mongo-*.ts',
        'src/testing/**',
      ],
      thresholds: {
        'src/domain/finance/**': { lines: 95, functions: 95, branches: 90, statements: 95 },
      },
    },
  },
});
