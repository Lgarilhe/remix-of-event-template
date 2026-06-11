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
    // La nav principale est présente (repère stable : item Missions).
    await expect(page.getByRole('link', { name: 'Missions' })).toBeVisible();
  });

  test('agency-owner voit la nav Prospection/Marketplace (accès agence)', async ({ asRole }) => {
    const page = await asRole('agencyOwner');
    await page.goto('/dashboard');
    // Au moins une entrée agence-only doit être visible.
    await expect(page.getByRole('link', { name: /marketplace|prospection|vivier/i }).first()).toBeVisible();
  });

  test('freelance atterrit sur l\'app sans crash', async ({ asRole }) => {
    const page = await asRole('freelance');
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/auth/);
  });
});
