import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.es2022 } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  /* ---- architecture boundaries (see docs §1.4) ---- */
  {
    // the finance engine is PURE: no I/O libraries, no clock, no other layers
    files: ['apps/api/src/domain/finance/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'mongoose',
                'express',
                'ioredis',
                'bullmq',
                'pino*',
                'node:*',
                'fs',
                'path',
                'crypto',
              ],
              message: 'domain/finance must stay pure (no I/O).',
            },
            {
              group: [
                '**/db/**',
                '**/modules/**',
                '**/config/**',
                '**/lib/**',
                '**/domain/billing/**',
                '**/domain/academic/**',
              ],
              message: 'domain/finance may only depend on @sfm/shared.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Use the injected Clock / BusinessDate helpers.' },
      ],
    },
  },
  {
    // commercial billing is isolated from the fee engine (BRC-K1)
    files: ['apps/api/src/domain/billing/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/domain/finance/**', '**/db/**', '**/modules/**'],
              message: 'domain/billing must not depend on the fee engine or persistence.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/domain/academic/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['mongoose', 'express', '**/db/**', '**/modules/**'],
              message: 'domain/academic must stay pure.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/testing/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-restricted-globals': 'off' },
  },
);
