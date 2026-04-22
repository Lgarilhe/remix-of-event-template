import { test, expect } from '@playwright/test';

test.describe('/auth page', () => {
  test('shows login form with email and password fields by default', async ({ page }) => {
    await page.goto('/auth');

    await expect(page.getByRole('heading', { name: /Connexion/i })).toBeVisible();

    const emailInput = page.getByPlaceholder(/Email/i);
    const passwordInput = page.getByPlaceholder(/Mot de passe/i);

    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute('type', 'password');

    await expect(page.getByRole('button', { name: /Connexion/i })).toBeVisible();
  });

  test('email input rejects invalid format via native validation', async ({ page }) => {
    await page.goto('/auth');

    const emailInput = page.getByPlaceholder(/Email/i);
    await emailInput.fill('not-an-email');
    await page.getByRole('button', { name: /^Connexion$/i }).click();

    const validity = await emailInput.evaluate(
      (el) => (el as HTMLInputElement).validity.valid,
    );
    expect(validity).toBe(false);
  });
});
