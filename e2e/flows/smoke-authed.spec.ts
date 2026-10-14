/**
 * Smoke authentifié — vérifie que les rôles atterrissent bien dans l'app
 * (la brique débloquée par le socle storageState). Étend les 3 specs existantes
 * non authentifiées.
 *
 * @smoke
 */
import { test, expect } from '../fixtures';

test.describe('@smoke Accès authentifié par rôle', () => {
  test('agency-owner accède au dashboard sans repasser par /auth', async ({ asRole }) => {
    const page = await asRole('agencyOwner');
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/auth/);
    // La barre latérale est présente (repère stable : onglet Missions).
    await expect(page.getByRole('tab', { name: 'Missions' })).toBeVisible();
  });

  test('agency-owner accède à Marketplace depuis Plus (accès agence)', async ({ asRole }) => {
    const page = await asRole('agencyOwner');
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /^Plus(?:,|$)/ }).click();
    const marketplace = page.getByRole('menuitem', { name: 'Marketplace', exact: true });
    await expect(marketplace).toBeVisible();
    await expect(marketplace).toHaveAttribute('href', '/marketplace');
    await marketplace.click();
    await expect(page).toHaveURL(/\/marketplace$/);
  });

  test('freelance atterrit sur l\'app sans crash', async ({ asRole }) => {
    const page = await asRole('freelance');
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/auth/);
  });
});
