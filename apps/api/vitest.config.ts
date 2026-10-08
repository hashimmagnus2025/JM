import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts', 'src/lib/**/*.ts', 'src/modules/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/**/ports.ts', 'src/**/mongo-*.ts', 'src/testing/**'],
      thresholds: {
        'src/domain/finance/**': { lines: 95, functions: 95, branches: 90, statements: 95 },
      },
    },
  },
});
