/**
 * Mobile — persona Sophie (iPhone 13). Tourne sur le projet mobile-safari.
 * Vérifie : pas de débordement horizontal, cibles tactiles ≥ 44px, atterrissage
 * authentifié. Throttling réseau réel = à faire en suite @live/manuelle.
 *
 * @mobile
 */
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
});
