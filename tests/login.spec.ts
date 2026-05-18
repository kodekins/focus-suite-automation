import { expect, test } from '@playwright/test';
import 'dotenv/config';

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function envOr(name: string, fallbackName: string): string {
  return process.env[name] || requiredEnv(fallbackName);
}

function urlJoin(base: string, path: string): string {
  if (!base) return path;
  if (!path) return base;
  if (base.endsWith('/') && path.startsWith('/')) return base + path.slice(1);
  if (!base.endsWith('/') && !path.startsWith('/')) return `${base}/${path}`;
  return base + path;
}

test.describe('dashboard flow (correct credentials)', () => {
  const baseUrl = requiredEnv('BASE_URL');
  const loginPath = requiredEnv('LOGIN_PATH');
  const goodUsername = envOr('HTTP_AUTH_USERNAME', 'USERNAME');
  const goodPassword = envOr('HTTP_AUTH_PASSWORD', 'PASSWORD');

  const startUrl = urlJoin(baseUrl, loginPath);
  const postLoginUrlRegex = /dashboard-configuration/i;

  test('open dashboard configuration successfully', async ({ page }) => {
    test.setTimeout(120_000);

    await test.step('Configure HTTP credentials', async () => {
      await page.context().setHTTPCredentials({ username: goodUsername, password: goodPassword });
    });

    await test.step('Start from a blank page (video clarity)', async () => {
      await page.goto('about:blank');
      await page.waitForTimeout(750);
    });

    await test.step('Navigate to dashboard configuration URL', async () => {
      const response = await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => null);
      expect(response?.ok()).toBeTruthy();
      await expect(page).toHaveURL(postLoginUrlRegex, { timeout: 60_000 });
    });

    await test.step('Wait until dashboard is actually rendered (not loader)', async () => {
      await page.waitForLoadState('load', { timeout: 45_000 }).catch(() => undefined);

      // Best-effort: wait for common loaders/spinners/progress indicators to disappear.
      const loaderCandidates = page.locator(
        [
          '[role="progressbar"]',
          '.spinner',
          '.loading',
          '.loader',
          '[data-testid*="loader" i]',
          '[data-testid*="loading" i]',
          'text=/loading/i',
        ].join(', '),
      );

      if (await loaderCandidates.first().isVisible().catch(() => false)) {
        await loaderCandidates.first().waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);
      }

      // Small safety buffer so the video shows the dashboard state.
      await page.waitForTimeout(4000);
    });
  });
});

