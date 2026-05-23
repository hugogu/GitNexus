import { test, expect } from '@playwright/test';

/**
 * E2E tests for tree view mode switching.
 *
 * Requires:
 *   - gitnexus serve running on localhost:4747 with at least one indexed repo
 *   - gitnexus-web dev server running on localhost:5173
 *
 * Skipped when servers aren't available (CI without services, etc.).
 * Set E2E=1 to force-run even without the availability check.
 */

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4747';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

test.beforeAll(async () => {
  if (process.env.E2E) return;
  try {
    const [backendRes, frontendRes] = await Promise.allSettled([
      fetch(`${BACKEND_URL}/api/repos`),
      fetch(FRONTEND_URL),
    ]);
    if (
      backendRes.status === 'rejected' ||
      (backendRes.status === 'fulfilled' && !backendRes.value.ok)
    ) {
      test.skip(true, 'gitnexus serve not available on :4747');
      return;
    }
    if (
      frontendRes.status === 'rejected' ||
      (frontendRes.status === 'fulfilled' && !frontendRes.value.ok)
    ) {
      test.skip(true, 'Vite dev server not available on :5173');
      return;
    }
    if (backendRes.status === 'fulfilled') {
      const repos = await backendRes.value.json();
      if (!repos.length) {
        test.skip(true, 'No indexed repos — run gitnexus analyze first');
        return;
      }
    }
  } catch {
    test.skip(true, 'servers not available');
  }
});

test.describe('Tree View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FRONTEND_URL);
    await page.waitForSelector('.sigma-container', { timeout: 30000 });
  });

  test('should switch between force and tree views', async ({ page }) => {
    const forceTab = page.locator('button:has-text("力导向图")');
    const treeTab = page.locator('button:has-text("树形图")');

    await expect(forceTab).toHaveClass(/bg-accent/);
    await expect(treeTab).not.toHaveClass(/bg-accent/);

    await treeTab.click();
    await expect(treeTab).toHaveClass(/bg-accent/);
    await expect(forceTab).not.toHaveClass(/bg-accent/);

    await expect(page.locator('button:has-text("按字母")')).toBeVisible();
    await expect(page.locator('button:has-text("按调用次数")')).toBeVisible();

    await forceTab.click();
    await expect(forceTab).toHaveClass(/bg-accent/);
    await expect(treeTab).not.toHaveClass(/bg-accent/);

    await expect(page.locator('button:has-text("按字母")')).not.toBeVisible();
  });

  test('should interact with nodes in tree view', async ({ page }) => {
    await page.locator('button:has-text("树形图")').click();

    const canvas = page.locator('.sigma-container');
    await canvas.click();

    await expect(page.locator('text=Clear')).toBeVisible();
  });
});
