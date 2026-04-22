import { test, expect } from '@playwright/test';

test.describe('Landing page', () => {
  test('renders the Skalr landing hero and exposes primary CTAs', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/Skalr/i);

    const brand = page.getByRole('heading', { name: /^Skalr\.?$/, level: 1 }).first();
    await expect(brand).toBeVisible();

    const dashboardPreview = page.getByAltText(/Skalr dashboard preview/i);
    await expect(dashboardPreview).toBeVisible();
  });
});
