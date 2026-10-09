import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real web app against the real API and a real MongoDB.
 *   E2E_MONGO_URI=mongodb+srv://…/sfm_test?…   (a THROWAWAY database — it is wiped before every run;
 *                                               its name must contain "e2e" or "test")
 *   pnpm e2e
 * Dedicated ports (API 4100, web 5174) keep the run away from anything else on the machine.
 */
const mongo = process.env.E2E_MONGO_URI ?? '';
const API_PORT = 4100;
const WEB_PORT = 5174;
const WEB = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // our CSS honours prefers-reduced-motion; it also keeps axe from measuring contrast in the middle of a fade-in
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: '**/mobile.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 800 } },
    },
    {
      name: 'mobile',
      dependencies: ['desktop'],
      testMatch: '**/mobile.spec.ts',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: mongo
    ? [
        {
          // seed the throwaway DB first, then start the API (always a fresh server: the seed password is new every run)
          command:
            'pnpm --filter @sfm/api exec tsx src/db/e2e-prepare.ts && pnpm --filter @sfm/api exec tsx src/server.ts',
          url: `http://127.0.0.1:${API_PORT}/healthz`,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            NODE_ENV: 'development',
            PORT: String(API_PORT),
            LOG_LEVEL: 'warn',
            MONGO_URI: mongo,
            REDIS_URL: 'redis://localhost:6379',
            JWT_ACCESS_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-secret',
            S3_BUCKET: 'sfm-e2e',
            S3_ACCESS_KEY_ID: 'x',
            S3_SECRET_ACCESS_KEY: 'x',
            CORS_ORIGINS: WEB,
          },
        },
        {
          command: 'pnpm --filter @sfm/web dev',
          url: WEB,
          reuseExistingServer: false,
          timeout: 60_000,
          env: { WEB_PORT: String(WEB_PORT), API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
        },
      ]
    : undefined,
});
