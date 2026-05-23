import { test, expect } from '@playwright/test';

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
      test.skip(true, 'gitnexus serve not available');
      return;
    }
    if (
      frontendRes.status === 'rejected' ||
      (frontendRes.status === 'fulfilled' && !frontendRes.value.ok)
    ) {
      test.skip(true, 'Vite dev server not available');
      return;
    }
    if (backendRes.status === 'fulfilled') {
      const repos = await backendRes.value.json();
      if (!repos.length) {
        test.skip(true, 'No indexed repos');
      }
    }
  } catch {
    test.skip(true, 'servers not available');
  }
});

async function waitForGraphLoaded(page: import('@playwright/test').Page) {
  await page.goto('/');

  const landingCard = page.locator('[data-testid="landing-repo-card"]').first();
  try {
    await landingCard.waitFor({ state: 'visible', timeout: 15_000 });
    await landingCard.click();
  } catch {
    // auto-connect may skip the landing screen
  }

  const statusBar = page.getByRole('contentinfo');
  await expect(statusBar.getByText('Ready', { exact: true })).toBeVisible({ timeout: 45_000 });
}

test.describe('Tree View', () => {
  test('switches between force and tree while preserving selection context', async ({ page }) => {
    await waitForGraphLoaded(page);

    const firstGraphNode = page.getByTestId('file-tree-graph-node').first();
    await expect(firstGraphNode).toBeVisible({ timeout: 10_000 });
    await firstGraphNode.click();

    await page.getByTestId('switch-tree-view').click();
    await expect(page.getByTestId('tree-canvas')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('tree-root-group').first()).toBeVisible();
    await expect(
      page.locator('[data-testid="tree-canvas"] button[aria-pressed="true"]').first(),
    ).toBeVisible();

    await page.getByTestId('tree-sort-inboundDegree').click();
    await expect(page.getByTestId('tree-sort-inboundDegree')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByTestId('switch-force-view').click();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 });
  });
});
