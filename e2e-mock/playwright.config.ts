import { defineConfig, devices } from '@playwright/test';

/**
 * Browser checks for the screens running on MOCK data (no backend, no database):
 *   pnpm exec playwright test -c e2e-mock/playwright.config.ts
 */
const PORT = Number(process.env.MOCK_WEB_PORT ?? 5195);
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 800 } },
    },
    { name: 'mobile', testMatch: '**/mobile.spec.ts', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `pnpm --filter @sfm/web exec vite --mode mock --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
