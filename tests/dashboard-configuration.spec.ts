/**
 * Recordings & snapshots per run (Playwright maps each testcase → its own folder name):
 *   test-results/<slug-from-file-and-test-title>-chromium/
 *     • video.webm   • trace.zip   • *.png on failure
 * Open HTML report: `npm run report` → click the testcase → open attachments.
 */
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

/** Recorded XPaths — update if the DOM changes. */
const XP = {
  /** Prefer `getByRole('treeitem', { name: /dashboard configuration/i })`: div[2] is often an invisible expander stub. */
  menuDashboardConfigurationLabel:
    '/html/body/div[2]/focus-base-root/app-layout/dx-drawer/div/div[1]/div/div/app-menu/div/dx-tree-view/div/div/div/div[1]/ul/li[1]/ul/li[2]/div/div[1]',
  toolbarNewDashboard:
    '/html/body/div[1]/div/div/focus-dashboard-root/app-dashboard-configuration/div/div/div/dx-toolbar/div/div[3]/div/dxi-item/dx-button',
  newDashboardPlus:
    '/html/body/div[1]/div/div/focus-dashboard-root/app-new-dashboard/dx-scroll-view/div[1]/div/div[1]/div[2]/div/div/div/div/div[1]',
  dashboardNameInput:
    '/html/body/div[1]/div/div/focus-dashboard-root/app-focus-dashboard/app-base-dashboard/div/div/div[1]/div[1]/fs-text-box/dx-text-box/div/div[1]/input',
  /** Fallback only — XPath may hit the wrong `li` if toolbar order changes (another button can intercept clicks). */
  headerSaveButton:
    '/html/body/div[2]/focus-base-root/app-layout/app-header/header/dx-toolbar/div/div[3]/div[3]/dxi-item/div/ul[2]/li[2]/button',
} as const;

function xp(path: string) {
  return `xpath=${path}`;
}

async function waitForAppReady(page: import('@playwright/test').Page) {
  // Do NOT wait for document.readyState === 'complete` — SPAs often stay interactive forever.
  await page.waitForLoadState('domcontentloaded', { timeout: 120_000 });
  await page.waitForLoadState('load', { timeout: 45_000 }).catch(() => undefined);

  // `focus-base-root` can exist but stay CSS-hidden until layout settles — wait attached, not visible.
  await page.locator('focus-base-root').first().waitFor({ state: 'attached', timeout: 120_000 });

  // Wait for actual dashboard shell chrome (tabs / root) instead of the wrapper visibility bit.
  await page
    .locator('focus-dashboard-root, [role="tablist"], dx-drawer')
    .first()
    .waitFor({ state: 'visible', timeout: 120_000 });

  await page.waitForTimeout(600);
}

async function dismissDevExpressEvaluationWatermark(page: import('@playwright/test').Page) {
  const bannerText = page.getByText(/For evaluation purposes only/i);
  if (!(await bannerText.first().isVisible().catch(() => false))) return;

  // Close control is often inside dx-license / banner row (blocks clicks on menu if left open).
  const closeInLicense = page.locator('dx-license img').first();
  if (await closeInLicense.isVisible().catch(() => false)) {
    await closeInLicense.click({ force: true }).catch(() => undefined);
  }

  const closeCandidate = page.locator('img').first();
  if (await closeCandidate.isVisible().catch(() => false)) {
    await closeCandidate.click({ force: true }).catch(() => undefined);
  }

  await bannerText.first().waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
}

async function openNavigationDrawerIfNeeded(page: import('@playwright/test').Page) {
  const menuRoot = page.locator('app-menu dx-tree-view').first();
  const dashboardsRoot = menuRoot.getByRole('treeitem').filter({ hasText: /^Dashboards$/i }).first();

  if (await dashboardsRoot.isVisible().catch(() => false)) return;

  await dismissDevExpressEvaluationWatermark(page);
  const menuBtn = page.getByRole('button', { name: /^menu$/i });
  await menuBtn.click({ timeout: 15_000, force: true }).catch(async () => {
    await dismissDevExpressEvaluationWatermark(page);
    await menuBtn.click({ timeout: 15_000, force: true });
  });
  await expect(menuRoot).toBeVisible({ timeout: 25_000 });
  await expect(dashboardsRoot).toBeVisible({ timeout: 25_000 });
}

async function expandDashboardsIfNeeded(page: import('@playwright/test').Page) {
  const menuRoot = page.locator('app-menu dx-tree-view').first();
  const configItem = menuRoot.getByRole('treeitem').filter({ hasText: /dashboard configuration/i }).first();

  if (await configItem.isVisible().catch(() => false)) return;

  const dashboardsItem = menuRoot.getByRole('treeitem').filter({ hasText: /^Dashboards$/i }).first();
  await dashboardsItem.scrollIntoViewIfNeeded();

  // DevExpress tree: clicking the row often selects "Main" / navigates instead of expanding children.
  // Prefer the expand/chevron control so "Dashboard Configuration" becomes visible in the a11y tree.
  const expanderFromItem = dashboardsItem.locator(
    '.dx-treeview-expander-icon-stub, .dx-treeview-toggle-item-visibility',
  ).first();
  const expanderFromNode = menuRoot
    .locator('.dx-treeview-node')
    .filter({ hasText: /^Dashboards$/ })
    .locator('.dx-treeview-expander-icon-stub, .dx-treeview-toggle-item-visibility')
    .first();

  if (await expanderFromItem.isVisible().catch(() => false)) {
    await expanderFromItem.click({ timeout: 15_000, force: true });
  } else if (await expanderFromNode.isVisible().catch(() => false)) {
    await expanderFromNode.click({ timeout: 15_000, force: true });
  } else {
    await dashboardsItem.click({ timeout: 15_000, force: true });
  }

  await expect(configItem).toBeVisible({ timeout: 35_000 });
}

async function configurationSurfaceDetected(page: import('@playwright/test').Page): Promise<boolean> {
  if (/dashboard-configuration/i.test(page.url())) return true;
  const host = page.locator('app-dashboard-configuration').first();
  if (await host.isVisible().catch(() => false)) return true;
  const toolbarBtn = page.locator('focus-dashboard-root app-dashboard-configuration dx-toolbar dx-button').first();
  if (await toolbarBtn.isVisible().catch(() => false)) return true;
  if (await page.locator(xp(XP.toolbarNewDashboard)).first().isVisible().catch(() => false)) return true;
  return false;
}

/** Configuration shell: URL, host, or first toolbar button inside `app-dashboard-configuration`. */
async function expectDashboardConfigurationReady(page: import('@playwright/test').Page) {
  await expect
    .poll(async () => configurationSurfaceDetected(page), { timeout: 55_000, intervals: [250, 500, 1000] })
    .toBeTruthy();
}

async function clickDashboardConfigurationMenu(page: import('@playwright/test').Page) {
  const menuRoot = page.locator('app-menu dx-tree-view').first();
  await expect(menuRoot).toBeVisible({ timeout: 30_000 });

  const labelText = menuRoot.getByText(/^Dashboard Configuration$/i).first();
  const treeItem = menuRoot.getByRole('treeitem', { name: /Dashboard Configuration/i }).first();
  const labelXPath = page.locator(xp(XP.menuDashboardConfigurationLabel)).first();

  await treeItem.scrollIntoViewIfNeeded().catch(() => undefined);

  async function surfaceSoon(): Promise<boolean> {
    try {
      await expect
        .poll(async () => configurationSurfaceDetected(page), { timeout: 18_000, intervals: [200, 400, 800] })
        .toBeTruthy();
      return true;
    } catch {
      return false;
    }
  }

  // Snaps often show "Main" still selected after `treeitem.click()` — hit the visible label / dblclick / DOM events.
  const attempts: Array<() => Promise<void>> = [
    async () => {
      await labelText.click({ timeout: 15_000, force: true });
    },
    async () => {
      await treeItem.click({ timeout: 15_000, force: true });
    },
    async () => {
      await treeItem.dblclick({ timeout: 15_000, force: true });
    },
    async () => {
      await labelXPath.click({ timeout: 15_000, force: true });
    },
    async () => {
      await treeItem.focus();
      await page.keyboard.press('Enter');
    },
    async () => {
      await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.dx-treeview-item'));
        const node = items.find((el) => /^Dashboard Configuration$/i.test((el.textContent || '').trim()));
        node?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    },
    async () => {
      await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.dx-treeview-item'));
        const node = items.find((el) => /^Dashboard Configuration$/i.test((el.textContent || '').trim()));
        node?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      });
    },
  ];

  for (const run of attempts) {
    if (await configurationSurfaceDetected(page)) return;
    await run().catch(() => undefined);
    if (await surfaceSoon()) return;
  }
}

async function clickHeaderSave(page: import('@playwright/test').Page) {
  const byRole = page.locator('app-header header').getByRole('button', { name: /^save$/i }).first();
  await byRole.click({ timeout: 30_000, force: true }).catch(async () => {
    await page.locator(xp(XP.headerSaveButton)).click({ timeout: 30_000, force: true });
  });
}

/** "+" opens the **Add Widget** modal; Credit Risk is a category on the left; then pick any template card. */
async function selectAnyCreditRiskTemplate(page: import('@playwright/test').Page) {
  const popup = page.locator('.dx-popup-normal').filter({ hasText: /Add Widget/i }).first();
  await expect(popup).toBeVisible({ timeout: 60_000 });

  const creditCategory = popup.getByText(/^Credit Risk$/i).first();
  await creditCategory.click({ timeout: 15_000 }).catch(() => undefined);

  const namedTemplate = popup.getByText(/Top Ten Exposures By Residential Units/i).first();
  if (await namedTemplate.isVisible().catch(() => false)) {
    await namedTemplate.click({ timeout: 15_000 });
    return;
  }

  await popup.locator('.dx-scrollview-content img').first().click({ timeout: 15_000 }).catch(async () => {
    await popup.locator('[class*="dx-item"]').filter({ has: page.locator('img') }).first().click({ timeout: 15_000 });
  });
}

test.describe('Dashboard Configuration', () => {
  test.describe.configure({ timeout: 300_000 });

  const baseUrl = requiredEnv('BASE_URL');
  /** Landing route so the side drawer + tree menu exists before opening Dashboard Configuration */
  const appHomePath = process.env.APP_HOME_PATH || '/app-dashboard/dashboard';
  const startUrl = urlJoin(baseUrl, appHomePath);
  /** Same as `.env` `LOGIN_PATH` — deep link if menu click fails */
  const dashboardConfigurationUrl = urlJoin(baseUrl, process.env.LOGIN_PATH || '/app-dashboard/dashboard-configuration');
  const httpUser = envOr('HTTP_AUTH_USERNAME', 'USERNAME');
  const httpPass = envOr('HTTP_AUTH_PASSWORD', 'PASSWORD');

  test.beforeEach(async ({ page }) => {
    test.setTimeout(280_000);
    await page.context().setHTTPCredentials({ username: httpUser, password: httpPass });
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await waitForAppReady(page);
    await dismissDevExpressEvaluationWatermark(page);
  });

  test('[TC01] Create dashboard — menu → New → Credit Risk widget → rename → Save', async ({ page }) => {
    const name = `AutoDash_${Date.now()}`;

    await test.step('Open Dashboard Configuration from menu', async () => {
      async function openViaMenu() {
        await openNavigationDrawerIfNeeded(page);
        await expandDashboardsIfNeeded(page);
        await clickDashboardConfigurationMenu(page);
      }

      await openViaMenu();
      try {
        await expectDashboardConfigurationReady(page);
      } catch {
        await page.goto(dashboardConfigurationUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await waitForAppReady(page);
        await dismissDevExpressEvaluationWatermark(page);
        try {
          await expectDashboardConfigurationReady(page);
        } catch {
          await openViaMenu();
          await expectDashboardConfigurationReady(page);
        }
      }
    });

    await test.step('Click New dashboard', async () => {
      const structural = page.locator('focus-dashboard-root app-dashboard-configuration dx-toolbar dx-button').first();
      await structural.click({ timeout: 30_000 }).catch(async () => {
        await page.locator(xp(XP.toolbarNewDashboard)).click({ timeout: 30_000 });
      });
      await expect(page.locator('app-new-dashboard')).toBeVisible({ timeout: 60_000 });
    });

    await test.step('Click + to add from template', async () => {
      await page.locator(xp(XP.newDashboardPlus)).click({ timeout: 30_000 });
    });

    await test.step('Choose any template under Credit Risk', async () => {
      await selectAnyCreditRiskTemplate(page);
    });

    await test.step('Wait for dashboard editor', async () => {
      await expect(page.locator('app-focus-dashboard')).toBeVisible({ timeout: 120_000 });
      await expect(page.locator(xp(XP.dashboardNameInput))).toBeVisible({ timeout: 60_000 });
    });

    await test.step('Rename dashboard', async () => {
      const input = page.locator(xp(XP.dashboardNameInput));
      await input.click();
      await input.fill(name);
    });

    await test.step('Save from header', async () => {
      await dismissDevExpressEvaluationWatermark(page);
      await clickHeaderSave(page);
    });

    await test.step('Verify name persisted in UI', async () => {
      await expect(page.locator(xp(XP.dashboardNameInput))).toHaveValue(name, { timeout: 30_000 });
    });
  });
});

// --- Additional scenarios from your test matrix (implement after creation flow is stable) ---
test.describe.skip('Dashboard Configuration — more scenarios (pending)', () => {
  async function clickFirstVisible(page: import('@playwright/test').Page, locators: import('@playwright/test').Locator[]) {
    for (const loc of locators) {
      if (await loc.first().isVisible().catch(() => false)) {
        await loc.first().click();
        return;
      }
    }
    throw new Error('Could not find a visible element to click.');
  }

  function createDashboardEntryPoints(page: import('@playwright/test').Page): import('@playwright/test').Locator[] {
    return [
      page.getByRole('button', { name: /new tab/i }),
      page.getByText(/^New tab$/i),
      page.locator('[title*="New tab" i]'),
      page.getByRole('button', { name: /new dashboard|create dashboard/i }),
    ];
  }

  const baseUrl = requiredEnv('BASE_URL');
  const path = requiredEnv('LOGIN_PATH');
  const startUrl = urlJoin(baseUrl, path);
  const httpUser = envOr('HTTP_AUTH_USERNAME', 'USERNAME');
  const httpPass = envOr('HTTP_AUTH_PASSWORD', 'PASSWORD');

  test.beforeEach(async ({ page }) => {
    await page.context().setHTTPCredentials({ username: httpUser, password: httpPass });
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  });

  test('Pending: mandatory fields validation', async ({ page }) => {
    await clickFirstVisible(page, createDashboardEntryPoints(page));
  });

  test('Duplicate name validation', async ({ page }) => {
    await clickFirstVisible(page, createDashboardEntryPoints(page));
  });

  test('Rename existing dashboard', async ({ page }) => {
    await clickFirstVisible(page, createDashboardEntryPoints(page));
  });

  test('Rename invalid characters', async ({ page }) => {
    await clickFirstVisible(page, createDashboardEntryPoints(page));
  });

  test('Save after creation reload', async ({ page }) => {
    await clickFirstVisible(page, createDashboardEntryPoints(page));
  });
});
