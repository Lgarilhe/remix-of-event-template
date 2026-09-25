import { test, expect } from '@playwright/test';

test.describe('/auth page', () => {
  test('shows login form with email and password fields by default', async ({ page }) => {
    await page.goto('/auth');

    await expect(page.getByRole('heading', { name: /Connexion/i })).toBeVisible();

    // Champs repérés par leur libellé (design, lot 8 : chaque champ a un libellé associé).
    const emailInput = page.getByLabel('E-mail', { exact: true });
    const passwordInput = page.getByLabel('Mot de passe', { exact: true });

    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute('type', 'password');

    await expect(page.getByRole('button', { name: /^Se connecter$/i })).toBeVisible();
  });

  test('email input rejects invalid format via native validation', async ({ page }) => {
    await page.goto('/auth');

    const emailInput = page.getByLabel('E-mail', { exact: true });
    await emailInput.fill('not-an-email');
    await page.getByRole('button', { name: /^Se connecter$/i }).click();

    const validity = await emailInput.evaluate(
      (el) => (el as HTMLInputElement).validity.valid,
    );
    expect(validity).toBe(false);
  });
});
