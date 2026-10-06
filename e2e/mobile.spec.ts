/**
 * Mobile — persona Sophie (iPhone 13). Tourne sur le projet mobile-safari.
 * Vérifie : pas de débordement horizontal, cibles tactiles ≥ 44px, atterrissage
 * authentifié. Throttling réseau réel = à faire en suite @live/manuelle.
 *
 * @mobile
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { storageStateFor } from './helpers/registry';

test.use({ storageState: storageStateFor('freelance') });

test.describe('@mobile Konekt sur iPhone 13', () => {
  test('le dashboard ne déborde pas horizontalement', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/auth/);

    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      // tolérance 2px pour les arrondis sub-pixel
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow, 'débordement horizontal en px').toBeLessThanOrEqual(2);
  });

  test('les cibles de navigation principales font au moins ~44px', async ({ page }) => {
    await page.goto('/dashboard');
    // Ouvre le menu mobile si présent (souvent un bouton hamburger).
    const menuBtn = page.getByRole('button', { name: /menu|navigation/i });
    if (await menuBtn.count()) await menuBtn.first().click();

    const navLink = page.getByRole('link', { name: /missions|pipeline|dashboard/i }).first();
    if (await navLink.count()) {
      const box = await navLink.boundingBox();
      if (box) expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(40);
    }
  });

  // Paramètres, lot 2. describe imbriqué : le projet chromium-desktop exécute aussi ce
  // fichier, et le skip ne doit pas sauter les deux tests ci-dessus sur ordinateur.
  test.describe('Paramètres au téléphone', () => {
    test.skip(({ isMobile }) => !isMobile, 'téléphone uniquement');

    const settingsNav = (page: Page) => page.getByRole('navigation', { name: 'Rubriques des paramètres' });

    test('/settings affiche la liste : deux groupes, six lignes d’au moins 44 px, sans débordement', async ({ page }) => {
      await page.goto('/settings');
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Paramètres', exact: true })).toBeVisible();

      const nav = settingsNav(page);
      await expect(nav.getByRole('heading', { level: 2 })).toHaveCount(2);
      const rows = nav.getByRole('link');
      await expect(rows).toHaveCount(6); // indépendant : pas d'Équipe

      const overflow = await page.evaluate(() => {
        const el = document.scrollingElement || document.documentElement;
        return el.scrollWidth - el.clientWidth;
      });
      expect(overflow, 'débordement horizontal en px').toBeLessThanOrEqual(2);

      const heights = await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      for (const h of heights) expect(h, 'hauteur d’une ligne en px').toBeGreaterThanOrEqual(44);
    });

    test('une rubrique s’ouvre en plein écran ; « Paramètres » revient à la liste sans boucle', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/dashboard$/);
      await page.goto('/settings');
      const connections = settingsNav(page).getByRole('link', { name: 'Connexions', exact: true });
      await connections.click();

      await expect(page).toHaveURL(/\/settings\/account\/connections$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Connexions', exact: true })).toBeVisible();
      await expect(settingsNav(page)).toHaveCount(0);

      await page.getByRole('link', { name: 'Retour aux paramètres' }).click();
      await expect(page).toHaveURL(/\/settings$/);
      // La liste rend le focus à la ligne d'origine.
      await expect(settingsNav(page).getByRole('link', { name: 'Connexions', exact: true })).toBeFocused();

      // Venu de la liste, le lien est revenu en arrière : le Retour quitte les Paramètres.
      await page.goBack();
      await expect(page).toHaveURL(/\/dashboard$/);
    });

    test('un lien direct ouvre la rubrique, pas la liste', async ({ page }) => {
      await page.goto('/settings/org/billing');
      await expect(page).toHaveURL(/\/settings\/org\/billing$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Abonnement et crédits', exact: true })).toBeVisible();
      await expect(settingsNav(page)).toHaveCount(0);
    });
  });
});
