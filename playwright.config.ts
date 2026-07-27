// Playwright config for Electron E2E tests.
//
// The app must be built first (vite build --config vite.config.electron.mjs)
// so that dist-electron/index.html + electron/*.cjs are up to date — the
// `test:e2e` npm script below does this automatically via `pretest:e2e`.
//
// Each spec launches its own Electron instance via tests/support/electronApp.ts
// (playwright's `_electron.launch`), so tests do not share a running app
// process. Recording files are isolated per-test using RECORDINGS_DIR_OVERRIDE
// (see tests/support/electronApp.ts) so no test touches the real
// ~/.claude/agent-teams-recordings directory on the machine running the suite.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/specs',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false, // Electron E2E: one app instance per test, run serially to avoid resource contention
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
