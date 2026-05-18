import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

export default defineConfig({
  testDir: './tests',
  /** Per-test default; long flows override with test.setTimeout / describe.configure */
  timeout: 120_000,
  outputDir: 'test-results',
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  use: {
    // For "Your connection is not private" / self-signed certs.
    ignoreHTTPSErrors: true,

    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'on',
    viewport: { width: 1366, height: 768 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

