import { test, expect } from '@playwright/test';

const PROTECTED_ROUTES = ['/dashboard', '/missions', '/pipeline', '/inbox', '/settings'];

test.describe('Auth gating', () => {
  for (const route of PROTECTED_ROUTES) {
    test(`anonymous visit to ${route} redirects to /auth`, async ({ page }) => {
      await page.goto(route);
      await page.waitForURL(/\/auth(\?|$)/);
      await expect(page).toHaveURL(/\/auth(\?|$)/);
      await expect(page.getByRole('heading', { name: /Connexion/i })).toBeVisible();
    });
  }
});
